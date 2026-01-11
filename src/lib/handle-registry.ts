import "server-only";

import { Prisma } from "@prisma/client";

import { db } from "@/lib/database";
import type { ApiError, Result } from "@/lib/api-shapes";
import { err, ok } from "@/lib/api-shapes";
import { makeHandleCandidate, parseHandle } from "@/lib/handle";

/**
 * Server-only handle lifecycle helpers.
 *
 * Canonical routing:
 * - Resolve routes via the `Handle` table (status=ACTIVE) + the canonical owner mapping table (`HandleOwner`).
 * - Released/retired handles intentionally 404 (no redirects).
 *
 * Lifecycle rules:
 * - ACTIVE: resolves (current owner is the `HandleOwner` row for the handle).
 * - RELEASED: temporarily unavailable; previous owner may reclaim after cooldown.
 * - RETIRED: never claimable.
 */

export type HandleOwnerType = "USER" | "COMMUNITY";

export type HandleOwner = {
  ownerType: HandleOwnerType;
  ownerId: string;
};

export type HandleErrorCode =
  | "HANDLE_INVALID"
  | "HANDLE_TAKEN"
  | "HANDLE_RETIRED"
  | "HANDLE_COOLDOWN"
  | "HANDLE_RESERVED_FOR_PREVIOUS_OWNER"
  | "HANDLE_NOT_AVAILABLE";

export type HandleProblem = ApiError<
  HandleErrorCode,
  400 | 409,
  {
    reclaimUntil?: Date;
    availableAt?: Date;
  }
>;

export type HandleResult<T> = Result<T, HandleProblem>;

export const DEFAULT_COOLDOWN_DAYS = 7;
export const DEFAULT_RECLAIM_DAYS = 30;

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function invalidHandle(message: string): HandleProblem {
  return {
    code: "HANDLE_INVALID",
    message,
    status: 400,
  };
}

function taken(): HandleProblem {
  return {
    code: "HANDLE_TAKEN",
    message: "Handle is already taken.",
    status: 409,
  };
}

function retired(): HandleProblem {
  return {
    code: "HANDLE_RETIRED",
    message: "Handle is retired.",
    status: 409,
  };
}

function cooldown(meta: { reclaimUntil?: Date; availableAt?: Date }): HandleProblem {
  return {
    code: "HANDLE_COOLDOWN",
    message: "Handle is cooling down.",
    status: 409,
    meta,
  };
}

function reserved(meta: { reclaimUntil?: Date; availableAt?: Date }): HandleProblem {
  return {
    code: "HANDLE_RESERVED_FOR_PREVIOUS_OWNER",
    message: "Handle is reserved for the previous owner.",
    status: 409,
    meta,
  };
}

function notAvailable(meta: { reclaimUntil?: Date; availableAt?: Date } = {}): HandleProblem {
  return {
    code: "HANDLE_NOT_AVAILABLE",
    message: "Handle is not available.",
    status: 409,
    meta,
  };
}

type HandleRow = {
  id: string;
  status: "ACTIVE" | "RELEASED" | "RETIRED";
  lastOwnerType: HandleOwnerType | null;
  lastOwnerId: string | null;
  reclaimUntil: Date | null;
  availableAt: Date | null;
};

async function currentOwnerForHandleId(
  client: Prisma.TransactionClient | typeof db,
  handleId: string,
): Promise<HandleOwner | null> {
  const row = await client.handleOwner.findUnique({
    where: { handleId },
    select: { ownerType: true, ownerId: true },
  });

  return row ? { ownerType: row.ownerType, ownerId: row.ownerId } : null;
}

function sameLastOwner(row: HandleRow, claimant: HandleOwner): boolean {
  return row.lastOwnerType === claimant.ownerType && row.lastOwnerId === claimant.ownerId;
}

function evaluateClaimability(args: {
  row: HandleRow | null;
  now: Date;
  claimant: HandleOwner;
  currentOwner: HandleOwner | null;
}): HandleResult<null> {
  const { row, now, claimant, currentOwner } = args;

  if (!row) return ok(null);

  if (row.status === "RETIRED") return err(retired());

  if (row.status === "ACTIVE") {
    // ACTIVE is only claimable by the current owner (implied by handleId foreign keys).
    if (!currentOwner) return err(notAvailable());
    return currentOwner.ownerType === claimant.ownerType && currentOwner.ownerId === claimant.ownerId
      ? ok(null)
      : err(taken());
  }

  // RELEASED
  const reclaimUntil = row.reclaimUntil ?? undefined;
  const availableAt = row.availableAt ?? undefined;

  // No timing info means treat as not available (conservative).
  if (!row.reclaimUntil || !row.availableAt) {
    return err(notAvailable({ reclaimUntil, availableAt }));
  }

  // Cooldown window: nobody can claim.
  if (now < row.reclaimUntil) {
    return err(cooldown({ reclaimUntil, availableAt }));
  }

  // Reclaim window: only previous owner.
  if (now < row.availableAt) {
    return sameLastOwner(row, claimant) ? ok(null) : err(reserved({ reclaimUntil, availableAt }));
  }

  // Public.
  return ok(null);
}

function selectHandleRow() {
  return {
    id: true,
    status: true,
    lastOwnerType: true,
    lastOwnerId: true,
    reclaimUntil: true,
    availableAt: true,
  } as const;
}

export async function resolveUserIdFromHandle(raw: string): Promise<string | null> {
  const parsed = parseHandle(raw);
  if (!parsed.ok) return null;

  const handle = await db.handle.findUnique({
    where: { name: parsed.value },
    select: { id: true, status: true },
  });

  if (!handle || handle.status !== "ACTIVE") return null;

  const owner = await db.handleOwner.findUnique({
    where: { handleId: handle.id },
    select: { ownerType: true, ownerId: true },
  });

  if (!owner || owner.ownerType !== "USER") return null;
  return owner.ownerId;
}

export async function resolveCommunityIdFromHandle(raw: string): Promise<string | null> {
  const parsed = parseHandle(raw);
  if (!parsed.ok) return null;

  const handle = await db.handle.findUnique({
    where: { name: parsed.value },
    select: { id: true, status: true },
  });

  if (!handle || handle.status !== "ACTIVE") return null;

  const owner = await db.handleOwner.findUnique({
    where: { handleId: handle.id },
    select: { ownerType: true, ownerId: true },
  });

  if (!owner || owner.ownerType !== "COMMUNITY") return null;
  return owner.ownerId;
}

/**
 * Validate a handle and return whether it is claimable by a given owner.
 *
 * Useful for:
 * - onboarding validation
 * - availability checks
 */
export async function checkHandle(args: {
  handle: string;
  owner: HandleOwner;
}): Promise<HandleResult<{ handle: string }>> {
  const parsed = parseHandle(args.handle);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message));

  const handle = parsed.value;

  const row = (await db.handle.findUnique({
    where: { name: handle },
    select: selectHandleRow(),
  })) as HandleRow | null;

  const currentOwner = row && row.status === "ACTIVE" ? await currentOwnerForHandleId(db, row.id) : null;

  const claimable = evaluateClaimability({
    row,
    now: new Date(),
    claimant: args.owner,
    currentOwner,
  });
  if (!claimable.ok) return claimable;

  return ok({ handle });
}

/**
 * Validate a handle for a new owner when the owner's id is not known yet.
 *
 * This is used during creation flows (e.g. community creation) where Prisma will
 * generate the owner id (cuid) during the create.
 *
 * Semantics are intentionally simple and explicit:
 * - ACTIVE: not claimable
 * - RETIRED: not claimable
 * - RELEASED: claimable only once it is public (now >= availableAt)
 *
 * We do NOT attempt to grant reclaim-window exceptions without a concrete ownerId.
 */
export async function checkHandleForNewOwner(
  args: { handle: string },
  client: Prisma.TransactionClient | typeof db = db,
): Promise<HandleResult<{ handle: string }>> {
  const parsed = parseHandle(args.handle);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message));

  const handle = parsed.value;

  const row = (await client.handle.findUnique({
    where: { name: handle },
    select: selectHandleRow(),
  })) as HandleRow | null;

  if (!row) return ok({ handle });

  if (row.status === "RETIRED") return err(retired());
  if (row.status === "ACTIVE") return err(taken());

  // RELEASED
  const reclaimUntil = row.reclaimUntil ?? undefined;
  const availableAt = row.availableAt ?? undefined;

  if (!row.availableAt) {
    return err(notAvailable({ reclaimUntil, availableAt }));
  }

  const now = new Date();
  if (now < row.availableAt) {
    // Not public yet (includes cooldown + reclaim window).
    return err(notAvailable({ reclaimUntil, availableAt }));
  }

  return ok({ handle });
}

/**
 * Claim (or switch to) a handle for a USER or COMMUNITY.
 * This updates the canonical `HandleOwner` mapping and the Handle lifecycle table in a single transaction.
 */
export async function claimHandle(args: {
  ownerType: HandleOwnerType;
  ownerId: string;
  handle: string;
}): Promise<HandleResult<{ handle: string }>> {
  const parsed = parseHandle(args.handle);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message));

  const desired = parsed.value;
  const owner: HandleOwner = { ownerType: args.ownerType, ownerId: args.ownerId };

  return db.$transaction(async (tx) => {
    // Current mapping for this owner (enforced by @@unique([ownerType, ownerId])).
    const currentMapping = await tx.handleOwner.findUnique({
      where: { ownerType_ownerId: { ownerType: args.ownerType, ownerId: args.ownerId } },
      select: { handleId: true },
    });

    const currentHandleId = currentMapping?.handleId ?? null;

    // Fast path: already owns the desired handle.
    const desiredExisting = await tx.handle.findUnique({ where: { name: desired }, select: { id: true } });
    if (currentHandleId && desiredExisting && currentHandleId === desiredExisting.id) {
      return ok({ handle: desired });
    }

    // Evaluate desired row under the transaction.
    const desiredRow = (await tx.handle.findUnique({
      where: { name: desired },
      select: selectHandleRow(),
    })) as HandleRow | null;

    const currentOwner = desiredRow && desiredRow.status === "ACTIVE" ? await currentOwnerForHandleId(tx, desiredRow.id) : null;
    const claimable = evaluateClaimability({ row: desiredRow, now: new Date(), claimant: owner, currentOwner });
    if (!claimable.ok) return claimable;

    const now = new Date();

    // Release current handle (if any): mark lifecycle + drop canonical owner mapping.
    if (currentHandleId) {
      const reclaimUntil = addDays(now, DEFAULT_COOLDOWN_DAYS);
      const availableAt = addDays(reclaimUntil, DEFAULT_RECLAIM_DAYS);

      await tx.handle.updateMany({
        where: { id: currentHandleId, status: "ACTIVE" },
        data: {
          status: "RELEASED",
          lastOwnerType: args.ownerType,
          lastOwnerId: args.ownerId,
          reclaimUntil,
          availableAt,
        },
      });

      await tx.handleOwner.deleteMany({
        where: { handleId: currentHandleId, ownerType: args.ownerType, ownerId: args.ownerId },
      });
    }

    // Ensure desired handle row exists.
    if (!desiredRow) {
      try {
        await tx.handle.create({
          data: { name: desired, status: "ACTIVE" },
        });
      } catch (e) {
        // Another transaction may have created it first.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
          // fall through
        } else {
          throw e;
        }
      }
    }

    // If the desired row exists and is RELEASED, activate it.
    if (desiredRow && desiredRow.status === "RELEASED") {
      const updated = await tx.handle.updateMany({
        where: { name: desired, status: "RELEASED" },
        data: {
          status: "ACTIVE",
          reclaimUntil: null,
          availableAt: null,
          lastOwnerType: null,
          lastOwnerId: null,
        },
      });

      if (updated.count === 0) {
        return err(taken());
      }
    }

    const claimed = await tx.handle.findUnique({ where: { name: desired }, select: { id: true, status: true } });
    if (!claimed || claimed.status !== "ACTIVE") {
      return err(notAvailable());
    }

    // Enforce canonical ownership: if someone else owns it, fail.
    const existingOwner = await tx.handleOwner.findUnique({
      where: { handleId: claimed.id },
      select: { ownerType: true, ownerId: true },
    });

    if (existingOwner && (existingOwner.ownerType !== args.ownerType || existingOwner.ownerId !== args.ownerId)) {
      return err(taken());
    }

    // Create or update the canonical owner mapping.
    // handleId is the PK (one owner per handle). ownerType+ownerId is unique (one handle per owner).
    await tx.handleOwner.upsert({
      where: { handleId: claimed.id },
      create: { handleId: claimed.id, ownerType: args.ownerType, ownerId: args.ownerId },
      update: { ownerType: args.ownerType, ownerId: args.ownerId },
    });

    return ok({ handle: desired });
  });
}

/**
 * Retire a handle permanently.
 * This is a rare admin-only operation.
 */
export async function retireHandle(args: {
  handle: string;
}): Promise<HandleResult<{ handle: string }>> {
  const parsed = parseHandle(args.handle);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message));

  const name = parsed.value;

  await db.handle.upsert({
    where: { name },
    create: { name, status: "RETIRED" },
    update: {
      status: "RETIRED",
      reclaimUntil: null,
      availableAt: null,
      lastOwnerType: null,
      lastOwnerId: null,
    },
  });

  return ok({ handle: name });
}

/**
 * Generate a globally-unique, publicly-claimable handle suggestion.
 * Uses `makeHandleCandidate(seed)` and appends numeric suffixes when needed.
 */
export async function ensureUniqueGlobalHandle(seed: string): Promise<string> {
  const base = makeHandleCandidate(seed);

  const isPubliclyAvailable = async (candidate: string): Promise<boolean> => {
    const row = await db.handle.findUnique({
      where: { name: candidate },
      select: { status: true, availableAt: true },
    });

    if (!row) return true;
    if (row.status === "ACTIVE") return false;
    if (row.status === "RETIRED") return false;

    // RELEASED: public only after availableAt.
    if (!row.availableAt) return false;
    return new Date() >= row.availableAt;
  };

  if (await isPubliclyAvailable(base)) return base;

  for (let i = 1; i <= 50; i++) {
    const cand = `${base}-${i}`;
    if (await isPubliclyAvailable(cand)) return cand;
  }

  return `${base}-${Date.now()}`;
}
