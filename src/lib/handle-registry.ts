import "server-only";

import { HandleOwnerType, HandleStatus, Prisma } from "@prisma/client";

import { db } from "@/lib/database";
import type { ApiError, Result } from "@/lib/api-shapes";
import { err, ok } from "@/lib/api-shapes";
import { handleKey, parseHandle } from "@/lib/handle";

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
 *
 * Date semantics:
 * - `reclaimUntil` and `availableAt` being NULL indicates missing/invalid lifecycle data.
 * - Such handles are treated as unavailable until dates are set properly.
 */

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

type HandleProblemMeta = {
  reclaimUntil?: Date;
  availableAt?: Date;
};

export type HandleProblem = ApiError<HandleErrorCode, 400 | 409, HandleProblemMeta>;

export type HandleResult<T> = Result<T, HandleProblem>;

// --- Handle-to-ID resolver canonical error types ---
export type HandleResolveErrorCode = "HANDLE_INVALID" | "USER_NOT_FOUND" | "COMMUNITY_NOT_FOUND";

export type HandleResolveProblem = ApiError<HandleResolveErrorCode, 400 | 404>;

export type HandleResolveResult<T> = Result<T, HandleResolveProblem>;

/**
 * Cooldown period: time before the previous owner can reclaim.
 * This should be configurable based on business requirements.
 */
export const DEFAULT_COOLDOWN_DAYS = 7;

/**
 * Reclaim period: additional time after cooldown where only the previous owner can claim.
 * This should be configurable based on business requirements.
 */

export const DEFAULT_RECLAIM_DAYS = 30;

const handleRowSelect = Prisma.validator<Prisma.HandleSelect>()({
  id: true,
  name: true,
  key: true,
  status: true,
  lastOwnerType: true,
  lastOwnerId: true,
  reclaimUntil: true,
  availableAt: true,
  owner: {
    select: {
      ownerType: true,
      ownerId: true,
    },
  },
});

type HandleRow = Prisma.HandleGetPayload<{ select: typeof handleRowSelect }>;

/**
 * Add days to a date (UTC-safe).
 */
function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Attach metadata to a HandleProblem.
 */
function withMeta(base: HandleProblem, meta?: HandleProblemMeta): HandleProblem {
  const reclaimUntil = meta?.reclaimUntil;
  const availableAt = meta?.availableAt;

  if (!reclaimUntil && !availableAt) return base;

  return {
    ...base,
    meta: { reclaimUntil, availableAt },
  };
}


function userNotFound(): HandleResolveProblem {
  return {
    code: "USER_NOT_FOUND",
    message: "User not found",
    status: 404
  };
}

function communityNotFound(): HandleResolveProblem {
  return {
    code: "COMMUNITY_NOT_FOUND",
    message: "Community not found",
    status: 404
  };
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

function cooldown(meta: HandleProblemMeta): HandleProblem {
  return withMeta(
    {
      code: "HANDLE_COOLDOWN",
      message: "Handle is cooling down.",
      status: 409,
    },
    meta,
  );
}

function reserved(meta: HandleProblemMeta): HandleProblem {
  return withMeta(
    {
      code: "HANDLE_RESERVED_FOR_PREVIOUS_OWNER",
      message: "Handle is reserved for the previous owner.",
      status: 409,
    },
    meta,
  );
}

function notAvailable(meta: HandleProblemMeta = {}): HandleProblem {
  return withMeta(
    {
      code: "HANDLE_NOT_AVAILABLE",
      message: "Handle is not available.",
      status: 409,
    },
    meta,
  );
}

/**
 * Check if the claimant is the same as the last owner.
 */
function sameLastOwner(row: HandleRow, claimant: HandleOwner): boolean {
  return row.lastOwnerType === claimant.ownerType && row.lastOwnerId === claimant.ownerId;
}

/**
 * Evaluate whether a handle can be claimed by a specific owner.
 * This is the core business logic for handle availability.
 */
function evaluateClaimability(args: {
  row: HandleRow | null;
  now: Date;
  claimant: HandleOwner;
  activeOwner: HandleOwner | null;
}): HandleResult<null> {
  const { row, now, claimant, activeOwner } = args;

  if (!row) return ok(null);

  if (row.status === HandleStatus.RETIRED) return err(retired());

  if (row.status === HandleStatus.ACTIVE) {
    // ACTIVE is only claimable by the current owner (enforced by HandleOwner mapping).
    if (!activeOwner) return err(notAvailable());

    return activeOwner.ownerType === claimant.ownerType && activeOwner.ownerId === claimant.ownerId
      ? ok(null)
      : err(taken());
  }

  if (row.status !== HandleStatus.RELEASED) {
    return err(
      notAvailable({
        reclaimUntil: row.reclaimUntil ?? undefined,
        availableAt: row.availableAt ?? undefined,
      }),
    );
  }

  // RELEASED
  const reclaimUntil = row.reclaimUntil ?? undefined;
  const availableAt = row.availableAt ?? undefined;

  // No timing info means treat as not available (conservative).
  // This indicates potential data integrity issue - consider logging.
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

export async function resolveUserIdFromHandle(raw: string): Promise<HandleResolveResult<string>> {
  const parsed = parseHandle(raw);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message) as HandleResolveProblem);

  const row = await db.handle.findUnique({
    where: { name: parsed.value },
    select: {
      status: true,
      owner: { select: { ownerType: true, ownerId: true } },
    },
  });

  if (!row || row.status !== HandleStatus.ACTIVE) return err(userNotFound());
  if (!row.owner || row.owner.ownerType !== HandleOwnerType.USER) return err(userNotFound());
  return ok(row.owner.ownerId);
}

export async function resolveCommunityIdFromHandle(raw: string): Promise<HandleResolveResult<string>> {
  const parsed = parseHandle(raw);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message) as HandleResolveProblem);

  const row = await db.handle.findUnique({
    where: { name: parsed.value },
    select: {
      status: true,
      owner: { select: { ownerType: true, ownerId: true } },
    },
  });

  if (!row || row.status !== HandleStatus.ACTIVE) return err(communityNotFound());
  if (!row.owner || row.owner.ownerType !== HandleOwnerType.COMMUNITY) return err(communityNotFound());
  return ok(row.owner.ownerId);
}

// Single owner (common case)
export async function resolveHandleNameForOwner(
  args: { ownerType: HandleOwnerType; ownerId: string },
  client: Prisma.TransactionClient | typeof db = db,
): Promise<string | null> {
  const row = await client.handleOwner.findUnique({
    where: { ownerType_ownerId: { ownerType: args.ownerType, ownerId: args.ownerId } },
    select: { handle: { select: { name: true, status: true } } },
  });

  if (!row) return null;
  if (row.handle.status !== HandleStatus.ACTIVE) return null;
  return row.handle.name;
}

// Batch (list routes)
export async function resolveHandleNamesForOwners(
  args: { ownerType: HandleOwnerType; ownerIds: string[] },
  client: Prisma.TransactionClient | typeof db = db,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (args.ownerIds.length === 0) return out;

  const rows = await client.handleOwner.findMany({
    where: {
      ownerType: args.ownerType,
      ownerId: { in: args.ownerIds },
    },
    select: {
      ownerId: true,
      handle: { select: { name: true, status: true } },
    },
  });

  for (const r of rows) {
    if (r.handle.status === HandleStatus.ACTIVE) out.set(r.ownerId, r.handle.name);
  }

  return out;
}

/**
 * Validate a handle and return whether it is claimable by a given owner.
 *
 * Useful for:
 * - onboarding validation
 * - availability checks
 */
export async function checkHandle(args: { handle: string; owner: HandleOwner }): Promise<HandleResult<{ handle: string }>> {
  const parsed = parseHandle(args.handle);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message));

  const key = handleKey(parsed.value);
  const row = await db.handle.findUnique({
    where: { key },
    select: handleRowSelect,
  });

  // Hyphen-insensitive uniqueness: if a different canonical name already exists for this key,
  // treat this input as taken to avoid confusing collisions.
  if (row && row.name !== parsed.value) return err(taken());

  const activeOwner =
    row && row.status === HandleStatus.ACTIVE && row.owner
      ? { ownerType: row.owner.ownerType, ownerId: row.owner.ownerId }
      : null;

  const claimable = evaluateClaimability({
    row,
    now: new Date(),
    claimant: args.owner,
    activeOwner,
  });
  if (!claimable.ok) return claimable;

  return ok({ handle: parsed.value });
}

/**
 * Check if a handle is publicly available (for new owners without a known ID yet).
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
export async function checkHandlePubliclyAvailable(
  args: { handle: string },
  client: Prisma.TransactionClient | typeof db = db,
): Promise<HandleResult<{ handle: string }>> {
  const parsed = parseHandle(args.handle);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message));

  const key = handleKey(parsed.value);
  const row = await client.handle.findUnique({
    where: { key },
    select: {
      name: true,
      status: true,
      reclaimUntil: true,
      availableAt: true,
    },
  });

  // Hyphen-insensitive uniqueness: if a different canonical name already exists for this key,
  // treat this input as taken to avoid confusing collisions.
  if (row && row.name !== parsed.value) return err(taken());

  if (!row) return ok({ handle: parsed.value });

  if (row.status === HandleStatus.RETIRED) return err(retired());
  if (row.status === HandleStatus.ACTIVE) return err(taken());

  const reclaimUntil = row.reclaimUntil ?? undefined;
  const availableAt = row.availableAt ?? undefined;

  if (row.status !== HandleStatus.RELEASED) {
    return err(notAvailable({ reclaimUntil, availableAt }));
  }

  // RELEASED
  if (!row.availableAt) {
    return err(notAvailable({ reclaimUntil, availableAt }));
  }

  if (new Date() < row.availableAt) {
    // Not public yet (includes cooldown + reclaim window).
    return err(notAvailable({ reclaimUntil, availableAt }));
  }

  return ok({ handle: parsed.value });
}

/**
 * Claim (or switch to) a handle for a USER or COMMUNITY.
 * This updates the canonical `HandleOwner` mapping and the Handle lifecycle table in a single transaction.
 */

export type ClaimHandleOk = { handle: string; handleId: string };
export type ClaimHandleResult = HandleResult<ClaimHandleOk>;


/**
 * Claim (or switch to) a handle for a USER or COMMUNITY.
 *
 * DEAD SIMPLE RULE:
 * - If you're already in a transaction, pass `tx`.
 * - If you're not, pass `db`.
 *
 * This keeps all Handle/HandleOwner lifecycle logic centralized here.
 */
export async function claimHandle(
  client: Prisma.TransactionClient | typeof db,
  args: {
    ownerType: HandleOwnerType;
    ownerId: string;
    handle: string;
  },
): Promise<ClaimHandleResult> {
  const parsed = parseHandle(args.handle);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message));

  const desired = parsed.value;
  const desiredKey = handleKey(desired);
  const claimant: HandleOwner = { ownerType: args.ownerType, ownerId: args.ownerId };

  // Current mapping for this owner (enforced by @@unique([ownerType, ownerId])).
  const currentMapping = await client.handleOwner.findUnique({
    where: { ownerType_ownerId: { ownerType: args.ownerType, ownerId: args.ownerId } },
    select: { handleId: true },
  });

  const currentHandleId = currentMapping?.handleId ?? null;

  // Load desired row once (hyphen-insensitive uniqueness).
  let desiredRow = await client.handle.findUnique({ where: { key: desiredKey }, select: handleRowSelect });

  // Fast path: already mapped to desired.
  if (currentHandleId && desiredRow && currentHandleId === desiredRow.id) {
    return ok({ handle: desiredRow.name, handleId: desiredRow.id });
  }

  const activeOwner =
    desiredRow && desiredRow.status === HandleStatus.ACTIVE && desiredRow.owner
      ? { ownerType: desiredRow.owner.ownerType, ownerId: desiredRow.owner.ownerId }
      : null;

  const claimable = evaluateClaimability({
    row: desiredRow,
    now: new Date(),
    claimant,
    activeOwner,
  });
  if (!claimable.ok) return claimable;

  const now = new Date();

  // Release current handle (if any): mark lifecycle + drop canonical owner mapping.
  if (currentHandleId) {
    const reclaimUntil = addDays(now, DEFAULT_COOLDOWN_DAYS);
    const availableAt = addDays(reclaimUntil, DEFAULT_RECLAIM_DAYS);
    await client.handle.updateMany({
      where: { id: currentHandleId, status: HandleStatus.ACTIVE },
      data: {
        status: HandleStatus.RELEASED,
        lastOwnerType: args.ownerType,
        lastOwnerId: args.ownerId,
        reclaimUntil,
        availableAt,
      },
    });
    await client.handleOwner.deleteMany({
      where: { handleId: currentHandleId, ownerType: args.ownerType, ownerId: args.ownerId },
    });
  }

  // Ensure desired handle exists.
  if (!desiredRow) {
    try {
      desiredRow = await client.handle.create({
        data: { name: desired, key: desiredKey, status: HandleStatus.ACTIVE },
        select: handleRowSelect,
      });
    } catch (e) {
      // Another transaction may have created it first.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        desiredRow = await client.handle.findUnique({ where: { key: desiredKey }, select: handleRowSelect });

        // Re-evaluate claimability after the race.
        if (!desiredRow) return err(notAvailable());

        const newActiveOwner =
          desiredRow.status === HandleStatus.ACTIVE && desiredRow.owner
            ? { ownerType: desiredRow.owner.ownerType, ownerId: desiredRow.owner.ownerId }
            : null;

        const recheck = evaluateClaimability({
          row: desiredRow,
          now: new Date(),
          claimant,
          activeOwner: newActiveOwner,
        });
        if (!recheck.ok) return recheck;
      } else {
        throw e;
      }
    }
  }

  if (!desiredRow) return err(notAvailable());

  // Hyphen-insensitive uniqueness: if this key exists with a different canonical name,
  // treat it as taken unless it is already owned by this claimant.
  if (desiredRow.name !== desired) {
    const collisionOwner = desiredRow.owner
      ? { ownerType: desiredRow.owner.ownerType, ownerId: desiredRow.owner.ownerId }
      : null;

    if (!collisionOwner) return err(taken());
    if (collisionOwner.ownerType !== args.ownerType || collisionOwner.ownerId !== args.ownerId) return err(taken());

    return ok({ handle: desiredRow.name, handleId: desiredRow.id });
  }

  // If the desired row exists and is RELEASED, activate it.
  if (desiredRow.status === HandleStatus.RELEASED) {
    const updated = await client.handle.updateMany({
      where: { id: desiredRow.id, status: HandleStatus.RELEASED },
      data: {
        status: HandleStatus.ACTIVE,
        reclaimUntil: null,
        availableAt: null,
        lastOwnerType: null,
        lastOwnerId: null,
      },
    });

    if (updated.count === 0) return err(taken());

    desiredRow = await client.handle.findUnique({ where: { id: desiredRow.id }, select: handleRowSelect });
    if (!desiredRow) return err(notAvailable());
  }

  if (desiredRow.status !== HandleStatus.ACTIVE) {
    return err(
      notAvailable({
        reclaimUntil: desiredRow.reclaimUntil ?? undefined,
        availableAt: desiredRow.availableAt ?? undefined,
      }),
    );
  }

  // Enforce canonical ownership: if someone else owns it, fail.
  const existingOwner = desiredRow.owner
    ? { ownerType: desiredRow.owner.ownerType, ownerId: desiredRow.owner.ownerId }
    : null;

  if (existingOwner && (existingOwner.ownerType !== args.ownerType || existingOwner.ownerId !== args.ownerId)) {
    return err(taken());
  }

  // Create or update the canonical owner mapping.
  await client.handleOwner.upsert({
    where: { handleId: desiredRow.id },
    create: { handleId: desiredRow.id, ownerType: args.ownerType, ownerId: args.ownerId },
    update: { ownerType: args.ownerType, ownerId: args.ownerId },
  });

  return ok({ handle: desiredRow.name, handleId: desiredRow.id });
}

export type ReleaseOwnerHandleOk = { released: true };
export type ReleaseOwnerHandleResult = HandleResult<ReleaseOwnerHandleOk>;

/**
 * Release the currently-owned handle for an owner.
 *
 * Used by delete flows so routes never touch `handle` / `handleOwner` tables directly.
 */
export async function releaseOwnerHandle(
  client: Prisma.TransactionClient | typeof db,
  args: {
    ownerType: HandleOwnerType;
    ownerId: string;
  },
): Promise<ReleaseOwnerHandleResult> {
  const mapping = await client.handleOwner.findUnique({
    where: { ownerType_ownerId: { ownerType: args.ownerType, ownerId: args.ownerId } },
    select: { handleId: true },
  });

  if (!mapping) return err(notAvailable());

  const now = new Date();
  const reclaimUntil = addDays(now, DEFAULT_COOLDOWN_DAYS);
  const availableAt = addDays(reclaimUntil, DEFAULT_RECLAIM_DAYS);

  const released = await client.handle.updateMany({
    where: { id: mapping.handleId, status: HandleStatus.ACTIVE },
    data: {
      status: HandleStatus.RELEASED,
      lastOwnerType: args.ownerType,
      lastOwnerId: args.ownerId,
      reclaimUntil,
      availableAt,
    },
  });

  if (released.count !== 1) return err(notAvailable({ reclaimUntil, availableAt }));

  await client.handleOwner.deleteMany({
    where: { handleId: mapping.handleId, ownerType: args.ownerType, ownerId: args.ownerId },
  });

  return ok({ released: true });
}

/**
 * Retire a handle permanently.
 * This is a rare admin-only operation.
 */
export async function retireHandle(args: { handle: string }): Promise<HandleResult<{ handle: string }>> {
  const parsed = parseHandle(args.handle);
  if (!parsed.ok) return err(invalidHandle(parsed.error.message));

  const name = parsed.value;
  const key = handleKey(name);

  await db.handle.upsert({
    where: { key },
    create: { name, key, status: HandleStatus.RETIRED },
    update: {
      status: HandleStatus.RETIRED,
      reclaimUntil: null,
      availableAt: null,
      lastOwnerType: null,
      lastOwnerId: null,
    },
  });

  return ok({ handle: name });
}
