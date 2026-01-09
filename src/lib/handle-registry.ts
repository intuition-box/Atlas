import "server-only";

import { randomBytes } from "node:crypto";

import { db } from "@/lib/database";
import { assertValidHandle, makeHandleCandidate, validateHandle } from "@/lib/handle";

export type HandleErrorCode =
  | "HANDLE_INVALID"
  | "HANDLE_TAKEN"
  | "HANDLE_RETIRED"
  | "HANDLE_COOLDOWN"
  | "HANDLE_NOT_AVAILABLE"
  | "HANDLE_NOT_PUBLIC_YET"
  | "HANDLE_RESERVED_FOR_PREVIOUS_OWNER";

export class HandleRegistryError extends Error {
  readonly code: HandleErrorCode;
  readonly reclaimUntil?: Date;
  readonly availableAt?: Date;

  constructor(
    code: HandleErrorCode,
    message: string,
    meta?: {
      reclaimUntil?: Date | null;
      availableAt?: Date | null;
    },
  ) {
    super(message);
    this.name = "HandleRegistryError";
    this.code = code;
    this.reclaimUntil = meta?.reclaimUntil ?? undefined;
    this.availableAt = meta?.availableAt ?? undefined;
  }
}

export function isHandleRegistryError(e: unknown): e is HandleRegistryError {
  return e instanceof HandleRegistryError;
}

function throwHandleError(
  code: HandleErrorCode,
  message: string,
  meta?: {
    reclaimUntil?: Date | null;
    availableAt?: Date | null;
  },
): never {
  throw new HandleRegistryError(code, message, meta);
}

/**
 * Server-only handle lifecycle helpers.
 *
 * Routing resolution uses canonical fields:
 * - User.handle
 * - Community.handle
 *
 * The Handle table is ONLY for lifecycle enforcement (cooldowns / retirement / history).
 */
export const HANDLE_POLICY = {
  /**
   * Cooldown before the *previous owner* may reclaim a released handle.
   * During this time: nobody can claim.
   */
  reclaimAfterDays: 7,

  /**
   * Public reuse window.
   * After this time: anyone can claim.
   */
  publicReuseAfterDays: 30,
} as const;

export type HandleOwnerType = "USER" | "COMMUNITY";

function addDays(d: Date, days: number) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function isSameOwner(a: { ownerType: HandleOwnerType; ownerId: string }, b?: {
  ownerType: HandleOwnerType | null;
  ownerId: string | null;
}) {
  return !!b && b.ownerType === a.ownerType && b.ownerId === a.ownerId;
}

function randomSuffix(len = 6): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[buf[i] % alphabet.length];
  return out;
}


/**
 * True if a canonical handle is currently in use or blocked.
 * - Checks canonical ownership (User.handle / Community.handle)
 * - Also treats Handle rows as blocking when status is ACTIVE or RETIRED
 * - RELEASED is not considered "taken" (it may still be unclaimable depending on timing)
 */
export async function isHandleTaken(raw: string): Promise<boolean> {
  const v = validateHandle(raw);
  if (!v.ok) return false;
  const key = v.normalized;

  const [u, c, h] = await Promise.all([
    db.user.findFirst({ where: { handle: key }, select: { id: true } }),
    db.community.findFirst({ where: { handle: key }, select: { id: true } }),
    db.handle.findUnique({ where: { name: key }, select: { status: true } }),
  ]);

  if (u || c) return true;
  if (!h) return false;
  return h.status === "ACTIVE" || h.status === "RETIRED";
}

/**
 * Resolve IDs from canonical handles (handle-only; no ID fallback).
 * Return null for invalid handles so callers can render 404.
 */
export async function resolveUserIdFromHandle(raw: string): Promise<string | null> {
  const v = validateHandle(raw);
  if (!v.ok) return null;

  const user = await db.user.findFirst({
    where: { handle: v.normalized },
    select: { id: true },
  });

  return user?.id ?? null;
}

export async function resolveCommunityIdFromHandle(raw: string): Promise<string | null> {
  const v = validateHandle(raw);
  if (!v.ok) return null;

  const community = await db.community.findFirst({
    where: { handle: v.normalized },
    select: { id: true },
  });

  return community?.id ?? null;
}

export async function getActiveHandleForOwner(args: {
  ownerType: HandleOwnerType;
  ownerId: string;
}): Promise<string | null> {
  if (args.ownerType === "USER") {
    const row = await db.user.findUnique({
      where: { id: args.ownerId },
      select: { handle: true },
    });
    return row?.handle ?? null;
  }

  const row = await db.community.findUnique({
    where: { id: args.ownerId },
    select: { handle: true },
  });
  return row?.handle ?? null;
}

/**
 * Returns the canonical (normalized) handle when publicly claimable right now (i.e., by a new owner).
 * Throws for common failure cases.
 */
export async function assertHandleAvailable(raw: string): Promise<string> {
  const key = assertValidHandle(raw);

  // Hard collision check against canonical fields.
  const [u, c] = await Promise.all([
    db.user.findFirst({ where: { handle: key }, select: { id: true } }),
    db.community.findFirst({ where: { handle: key }, select: { id: true } }),
  ]);
  if (u || c) throwHandleError("HANDLE_TAKEN", "Handle is already taken");

  const row = await db.handle.findUnique({
    where: { name: key },
    select: {
      status: true,
      reclaimUntil: true,
      availableAt: true,
    },
  });

  if (!row) return key;
  if (row.status === "RETIRED") throwHandleError("HANDLE_RETIRED", "That handle is not available");
  if (row.status === "ACTIVE") throwHandleError("HANDLE_TAKEN", "Handle is already taken");

  // RELEASED rules
  const now = new Date();
  const reclaimUntil = row.reclaimUntil;
  const availableAt = row.availableAt;

  // Defensive: if windows are missing, treat as not available.
  if (!reclaimUntil || !availableAt) {
    throwHandleError("HANDLE_NOT_AVAILABLE", "That handle is not available");
  }

  // Cooldown: nobody can claim.
  if (now < reclaimUntil) {
    throwHandleError("HANDLE_COOLDOWN", "That handle is cooling down", { reclaimUntil, availableAt });
  }

  // Exclusive reclaim window: only previous owner can claim.
  // From a general availability perspective, it's not public yet.
  if (now < availableAt) {
    throwHandleError("HANDLE_NOT_PUBLIC_YET", "That handle is not available yet", {
      reclaimUntil,
      availableAt,
    });
  }

  // Public reuse.
  return key;
}

/**
 * Returns the canonical (normalized) handle when claimable by the given owner right now.
 *
 * Differences vs `assertHandleAvailable`:
 * - During the exclusive reclaim window, only the previous owner may claim.
 * - If the handle is already ACTIVE and owned by the caller, this is a no-op.
 */
export async function assertHandleClaimableByOwner(args: {
  ownerType: HandleOwnerType;
  ownerId: string;
  raw: string;
}): Promise<string> {
  const key = assertValidHandle(args.raw);

  // Hard collision check against canonical fields.
  const [u, c] = await Promise.all([
    db.user.findFirst({ where: { handle: key }, select: { id: true } }),
    db.community.findFirst({ where: { handle: key }, select: { id: true } }),
  ]);

  if (u && !(args.ownerType === "USER" && u.id === args.ownerId)) {
    throwHandleError("HANDLE_TAKEN", "Handle is already taken");
  }
  if (c && !(args.ownerType === "COMMUNITY" && c.id === args.ownerId)) {
    throwHandleError("HANDLE_TAKEN", "Handle is already taken");
  }

  const row = await db.handle.findUnique({
    where: { name: key },
    select: {
      status: true,
      ownerType: true,
      ownerId: true,
      lastOwnerType: true,
      lastOwnerId: true,
      reclaimUntil: true,
      availableAt: true,
    },
  });

  if (!row) return key;

  if (row.status === "RETIRED") {
    throwHandleError("HANDLE_RETIRED", "That handle is not available");
  }

  if (row.status === "ACTIVE") {
    if (!isSameOwner({ ownerType: args.ownerType, ownerId: args.ownerId }, { ownerType: row.ownerType, ownerId: row.ownerId })) {
      throwHandleError("HANDLE_TAKEN", "Handle is already taken");
    }
    return key;
  }

  // RELEASED rules
  const now = new Date();
  const reclaimUntil = row.reclaimUntil;
  const availableAt = row.availableAt;

  // Defensive: if windows are missing, treat as not available.
  if (!reclaimUntil || !availableAt) {
    throwHandleError("HANDLE_NOT_AVAILABLE", "That handle is not available");
  }

  // Cooldown: nobody can claim.
  if (now < reclaimUntil) {
    throwHandleError("HANDLE_COOLDOWN", "That handle is cooling down", { reclaimUntil, availableAt });
  }

  // Exclusive reclaim window: only previous owner can claim.
  if (now < availableAt) {
    const isPreviousOwner = isSameOwner(
      { ownerType: args.ownerType, ownerId: args.ownerId },
      { ownerType: row.lastOwnerType, ownerId: row.lastOwnerId },
    );
    if (!isPreviousOwner) {
      throwHandleError("HANDLE_RESERVED_FOR_PREVIOUS_OWNER", "That handle is not available yet", {
        reclaimUntil,
        availableAt,
      });
    }
  }

  return key;
}

export type MakeHandleArgs = {
  ownerType: HandleOwnerType;
  ownerId: string;
  desired: string;
};

/**
 * Claim or change an owner's handle.
 * - Updates the canonical handle on User/Community.
 * - Updates Handle table for lifecycle enforcement and history.
 */
export async function makeHandle(args: MakeHandleArgs): Promise<string> {
  const desiredKey = assertValidHandle(args.desired);
  const now = new Date();

  return db.$transaction(async (tx) => {
    const current =
      args.ownerType === "USER"
        ? await tx.user.findUnique({
            where: { id: args.ownerId },
            select: { handle: true },
          })
        : await tx.community.findUnique({
            where: { id: args.ownerId },
            select: { handle: true },
          });

    const currentHandle: string | null = current?.handle ?? null;
    if (currentHandle === desiredKey) return desiredKey;

    // Hard collision check against canonical fields.
    const [u, c] = await Promise.all([
      tx.user.findFirst({ where: { handle: desiredKey }, select: { id: true } }),
      tx.community.findFirst({ where: { handle: desiredKey }, select: { id: true } }),
    ]);

    if (u && !(args.ownerType === "USER" && u.id === args.ownerId)) {
      throwHandleError("HANDLE_TAKEN", "Handle is already taken");
    }
    if (c && !(args.ownerType === "COMMUNITY" && c.id === args.ownerId)) {
      throwHandleError("HANDLE_TAKEN", "Handle is already taken");
    }

    const desiredRow = await tx.handle.findUnique({
      where: { name: desiredKey },
      select: {
        status: true,
        ownerType: true,
        ownerId: true,
        lastOwnerType: true,
        lastOwnerId: true,
        reclaimUntil: true,
        availableAt: true,
      },
    });

    if (desiredRow?.status === "RETIRED") {
      throwHandleError("HANDLE_RETIRED", "That handle is not available");
    }

    if (desiredRow?.status === "ACTIVE") {
      if (!isSameOwner(args, { ownerType: desiredRow.ownerType, ownerId: desiredRow.ownerId })) {
        throwHandleError("HANDLE_TAKEN", "Handle is already taken");
      }
      // Already owned by caller: continue (no-op at Handle table level).
    }

    if (desiredRow?.status === "RELEASED") {
      const reclaimUntil = desiredRow.reclaimUntil;
      const availableAt = desiredRow.availableAt;

      if (!reclaimUntil || !availableAt) {
        throwHandleError("HANDLE_NOT_AVAILABLE", "That handle is not available");
      }

      // Cooldown: nobody can claim.
      if (now < reclaimUntil) {
        throwHandleError("HANDLE_COOLDOWN", "That handle is cooling down", { reclaimUntil, availableAt });
      }

      // Exclusive reclaim window: only previous owner.
      if (now < availableAt) {
        const isPreviousOwner = isSameOwner(args, {
          ownerType: desiredRow.lastOwnerType,
          ownerId: desiredRow.lastOwnerId,
        });
        if (!isPreviousOwner) {
          throwHandleError("HANDLE_RESERVED_FOR_PREVIOUS_OWNER", "That handle is not available yet", {
            reclaimUntil,
            availableAt,
          });
        }
      }

      // else: public reuse, allowed.
    }

    // Release previous handle (no redirects): old handle becomes RELEASED.
    if (currentHandle && currentHandle !== desiredKey) {
      const reclaimUntil = addDays(now, HANDLE_POLICY.reclaimAfterDays);
      const availableAt = addDays(now, HANDLE_POLICY.publicReuseAfterDays);

      await tx.handle.upsert({
        where: { name: currentHandle },
        update: {
          status: "RELEASED",
          releasedAt: now,
          reclaimUntil,
          availableAt,
          lastOwnerType: args.ownerType,
          lastOwnerId: args.ownerId,
          // clear current owner pointers if present
          ownerType: null,
          ownerId: null,
        },
        create: {
          name: currentHandle,
          status: "RELEASED",
          releasedAt: now,
          reclaimUntil,
          availableAt,
          lastOwnerType: args.ownerType,
          lastOwnerId: args.ownerId,
          ownerType: null,
          ownerId: null,
        },
      });
    }

    // Claim desired handle.
    await tx.handle.upsert({
      where: { name: desiredKey },
      update: {
        status: "ACTIVE",
        claimedAt: now,
        releasedAt: null,
        reclaimUntil: null,
        availableAt: null,
        retiredAt: null,
        ownerType: args.ownerType,
        ownerId: args.ownerId,
      },
      create: {
        name: desiredKey,
        status: "ACTIVE",
        claimedAt: now,
        ownerType: args.ownerType,
        ownerId: args.ownerId,
      },
    });

    // Set canonical handle on the owner.
    if (args.ownerType === "USER") {
      await tx.user.update({
        where: { id: args.ownerId },
        data: { handle: desiredKey },
        select: { id: true },
      });
    } else {
      await tx.community.update({
        where: { id: args.ownerId },
        data: { handle: desiredKey },
        select: { id: true },
      });
    }

    return desiredKey;
  });
}

/**
 * Mark a handle permanently retired.
 * Use this when deleting an owner: old handles must never become available again.
 */
export async function retireHandle(name: string): Promise<void> {
  const key = assertValidHandle(name);
  const now = new Date();

  await db.handle.upsert({
    where: { name: key },
    update: {
      status: "RETIRED",
      retiredAt: now,
      // Ensure it never becomes claimable again.
      availableAt: null,
      reclaimUntil: null,
      releasedAt: null,
      ownerType: null,
      ownerId: null,
    },
    create: {
      name: key,
      status: "RETIRED",
      retiredAt: now,
      ownerType: null,
      ownerId: null,
    },
  });
}

/**
 * Generate a globally-unique, currently-claimable handle suggestion.
 *
 * Notes:
 * - This is best-effort and still race-prone; callers must handle unique conflicts on write.
 * - A suggestion will avoid handles that are cooling down or still in the exclusive reclaim window.
 */
export async function ensureUniqueGlobalHandle(base: string): Promise<string> {
  const root = makeHandleCandidate(base);

  // If the root isn't valid per our rules, fall back to a safe default.
  const vRoot = validateHandle(root);
  const rootKey = vRoot.ok ? vRoot.normalized : "member";

  // Try the root first.
  try {
    return await assertHandleAvailable(rootKey);
  } catch {
    // continue
  }

  // Try numeric suffixes.
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${rootKey}-${i}`;
    try {
      return await assertHandleAvailable(candidate);
    } catch {
      // continue
    }
  }

  // Final fallback.
  for (let tries = 0; tries < 25; tries++) {
    const candidate = `${rootKey}-${randomSuffix(6)}`;
    try {
      return await assertHandleAvailable(candidate);
    } catch {
      // continue
    }
  }

  // Extremely unlikely; last-resort always returns a syntactically valid handle.
  return assertValidHandle(`user-${randomSuffix(8)}`);
}