import "server-only";

import { db } from "@/lib/database";
import { assertValidHandle, validateHandle } from "@/lib/handle";

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

function ownerModel(ownerType: HandleOwnerType) {
  return ownerType === "USER" ? "user" : "community";
}

function isSameOwner(a: { ownerType: HandleOwnerType; ownerId: string }, b?: {
  ownerType: HandleOwnerType | null;
  ownerId: string | null;
}) {
  return !!b && b.ownerType === a.ownerType && b.ownerId === a.ownerId;
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
  const model = ownerModel(args.ownerType);
  const row = await (db as any)[model].findUnique({
    where: { id: args.ownerId },
    select: { handle: true },
  });
  return row?.handle ?? null;
}

/**
 * Returns the canonical (normalized) handle when claimable by *someone* right now.
 * Throws for common failure cases.
 */
export async function assertHandleAvailable(raw: string): Promise<string> {
  const key = assertValidHandle(raw);

  // Hard collision check against canonical fields.
  const [u, c] = await Promise.all([
    db.user.findFirst({ where: { handle: key }, select: { id: true } }),
    db.community.findFirst({ where: { handle: key }, select: { id: true } }),
  ]);
  if (u || c) throw new Error("Handle is already taken");

  const row = await db.handle.findUnique({
    where: { name: key },
    select: {
      status: true,
      reclaimUntil: true,
      availableAt: true,
    },
  });

  if (!row) return key;
  if (row.status === "RETIRED") throw new Error("That handle is not available");
  if (row.status === "ACTIVE") throw new Error("Handle is already taken");

  // RELEASED rules
  const now = new Date();
  const reclaimUntil = row.reclaimUntil;
  const availableAt = row.availableAt;

  // Defensive: if windows are missing, treat as not available.
  if (!reclaimUntil || !availableAt) throw new Error("That handle is not available");

  // Cooldown: nobody can claim.
  if (now < reclaimUntil) throw new Error("That handle is cooling down");

  // Exclusive reclaim window: only previous owner can claim.
  // From a general availability perspective, it's not public yet.
  if (now < availableAt) throw new Error("That handle is not available yet");

  // Public reuse.
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
    const model = ownerModel(args.ownerType);

    const current = await (tx as any)[model].findUnique({
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
      throw new Error("Handle is already taken");
    }
    if (c && !(args.ownerType === "COMMUNITY" && c.id === args.ownerId)) {
      throw new Error("Handle is already taken");
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

    if (desiredRow?.status === "RETIRED") throw new Error("That handle is not available");

    if (desiredRow?.status === "ACTIVE") {
      if (!isSameOwner(args, { ownerType: desiredRow.ownerType, ownerId: desiredRow.ownerId })) {
        throw new Error("Handle is already taken");
      }
      // Already owned by caller: continue (no-op at Handle table level).
    }

    if (desiredRow?.status === "RELEASED") {
      const reclaimUntil = desiredRow.reclaimUntil;
      const availableAt = desiredRow.availableAt;

      if (!reclaimUntil || !availableAt) throw new Error("That handle is not available");

      // Cooldown: nobody can claim.
      if (now < reclaimUntil) throw new Error("That handle is cooling down");

      // Exclusive reclaim window: only previous owner.
      if (now < availableAt) {
        const isPreviousOwner = isSameOwner(args, {
          ownerType: desiredRow.lastOwnerType,
          ownerId: desiredRow.lastOwnerId,
        });
        if (!isPreviousOwner) throw new Error("That handle is not available yet");
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
    await (tx as any)[model].update({
      where: { id: args.ownerId },
      data: { handle: desiredKey },
      select: { id: true },
    });

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
