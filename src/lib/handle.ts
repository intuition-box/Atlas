import "server-only";

import { isReservedHandle } from "@/config/reserved-handles";
import { db } from "@/lib/database";

/**
 * Handle policy
 *
 * - Allow changes
 * - No redirects (old handles 404)
 * - Previous owner can reclaim after 7 days
 * - Public reuse after 30 days
 * - Deleted entities RETIRE handles forever
 *
 * IMPORTANT:
 * - Routing resolution uses ONLY the canonical `handle` fields on User/Community.
 * - The `Handle` table is used ONLY for lifecycle enforcement (claim/release/reclaim/retire).
 */
export const HANDLE_POLICY = {
  reclaimWindowDays: 7,
  publicReuseAfterDays: 30,
} as const;

export const MIN_HANDLE_LEN = 3;
export const MAX_HANDLE_LEN = 32;

// Canonical: lowercase, hyphen-separated segments. (We accept '_' in input but normalize to '-')
export const handlePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type HandleValidationReason =
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_FORMAT"
  | "RESERVED";

export function normalizeHandle(input: string): string {
  let s = (input ?? "").toString().trim().toLowerCase();

  // Convert underscores to hyphens so users can't bypass reserved handles.
  s = s.replace(/_+/g, "-");

  // Convert whitespace/dots to hyphens, collapse, trim.
  s = s.replace(/[\s.]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");

  return s;
}

export function validateHandle(input: string): {
  ok: boolean;
  normalized: string;
  reason?: HandleValidationReason;
} {
  const h = normalizeHandle(input);

  if (h.length < MIN_HANDLE_LEN) return { ok: false, normalized: h, reason: "TOO_SHORT" };
  if (h.length > MAX_HANDLE_LEN) return { ok: false, normalized: h, reason: "TOO_LONG" };
  if (!handlePattern.test(h)) return { ok: false, normalized: h, reason: "INVALID_FORMAT" };
  if (isReservedHandle(h)) return { ok: false, normalized: h, reason: "RESERVED" };

  return { ok: true, normalized: h };
}

export function assertValidHandle(input: string): string {
  const v = validateHandle(input);
  if (v.ok) return v.normalized;

  // One friendly message is enough for MVP.
  throw new Error(
    "Invalid handle. Use 3–32 lowercase letters/numbers separated by hyphens (e.g. 'saulo' or 'saulo-pt')."
  );
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

type OwnerType = "USER" | "COMMUNITY";

function ownerModel(ownerType: OwnerType) {
  return ownerType === "USER" ? "user" : "community";
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

export async function resolveCommunityIdFromHandle(
  raw: string
): Promise<string | null> {
  const v = validateHandle(raw);
  if (!v.ok) return null;

  const community = await db.community.findFirst({
    where: { handle: v.normalized },
    select: { id: true },
  });

  return community?.id ?? null;
}

export async function getActiveHandleForOwner(args: {
  ownerType: OwnerType;
  ownerId: string;
}): Promise<string | null> {
  const model = ownerModel(args.ownerType);
  const row = await (db as any)[model].findUnique({
    where: { id: args.ownerId },
    select: { handle: true },
  });
  return row?.handle ?? null;
}

export async function assertHandleAvailable(raw: string): Promise<string> {
  const key = assertValidHandle(raw);

  const [user, community] = await Promise.all([
    db.user.findFirst({ where: { handle: key }, select: { id: true } }),
    db.community.findFirst({ where: { handle: key }, select: { id: true } }),
  ]);

  if (user || community) throw new Error("Handle is already taken.");

  const row = await db.handle.findUnique({
    where: { handle: key },
    select: { status: true, availableAt: true, updatedAt: true },
  });

  if (!row) return key;
  if (row.status === "RETIRED") throw new Error("That handle is not available.");
  if (row.status === "ACTIVE") throw new Error("Handle is already taken.");

  const releasedAt = row.updatedAt;
  const publicAt = row.availableAt ?? addDays(releasedAt, HANDLE_POLICY.publicReuseAfterDays);
  if (new Date() < publicAt) throw new Error("That handle is not available yet.");

  return key;
}

export type MakeHandleArgs = {
  ownerType: OwnerType;
  ownerId: string;
  desired: string;
};

/**
 * Claim or change an owner's handle.
 *
 * One function for both users and communities.
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
    if (currentHandle && currentHandle === desiredKey) return desiredKey;

    // Hard collision check against canonical fields (works even if ledger is missing).
    const [userOwner, communityOwner] = await Promise.all([
      tx.user.findFirst({ where: { handle: desiredKey }, select: { id: true } }),
      tx.community.findFirst({ where: { handle: desiredKey }, select: { id: true } }),
    ]);

    if (userOwner && !(args.ownerType === "USER" && userOwner.id === args.ownerId)) {
      throw new Error("Handle is already taken.");
    }

    if (
      communityOwner &&
      !(args.ownerType === "COMMUNITY" && communityOwner.id === args.ownerId)
    ) {
      throw new Error("Handle is already taken.");
    }

    const desiredRow = await tx.handle.findUnique({
      where: { handle: desiredKey },
      select: {
        status: true,
        ownerType: true,
        ownerId: true,
        availableAt: true,
        updatedAt: true,
      },
    });

    if (desiredRow?.status === "RETIRED") throw new Error("That handle is not available.");

    if (desiredRow?.status === "ACTIVE") {
      if (desiredRow.ownerType !== args.ownerType || desiredRow.ownerId !== args.ownerId) {
        throw new Error("Handle is already taken.");
      }
    }

    if (desiredRow?.status === "AVAILABLE") {
      const releasedAt = desiredRow.updatedAt;
      const reclaimAt = addDays(releasedAt, HANDLE_POLICY.reclaimWindowDays);
      const publicAt = desiredRow.availableAt ?? addDays(releasedAt, HANDLE_POLICY.publicReuseAfterDays);

      if (now < reclaimAt) {
        throw new Error("That handle is cooling down. Try again later.");
      }

      if (now < publicAt) {
        const isPreviousOwner = desiredRow.ownerType === args.ownerType && desiredRow.ownerId === args.ownerId;
        if (!isPreviousOwner) throw new Error("That handle is not available yet.");
      }
    }

    // Release previous handle.
    if (currentHandle && currentHandle !== desiredKey) {
      await tx.handle.upsert({
        where: { handle: currentHandle },
        update: {
          status: "AVAILABLE",
          availableAt: addDays(now, HANDLE_POLICY.publicReuseAfterDays),
          ownerType: args.ownerType,
          ownerId: args.ownerId,
        },
        create: {
          handle: currentHandle,
          status: "AVAILABLE",
          availableAt: addDays(now, HANDLE_POLICY.publicReuseAfterDays),
          ownerType: args.ownerType,
          ownerId: args.ownerId,
        },
      });
    }

    // Claim desired handle.
    await tx.handle.upsert({
      where: { handle: desiredKey },
      update: {
        status: "ACTIVE",
        availableAt: null,
        ownerType: args.ownerType,
        ownerId: args.ownerId,
      },
      create: {
        handle: desiredKey,
        status: "ACTIVE",
        availableAt: null,
        ownerType: args.ownerType,
        ownerId: args.ownerId,
      },
    });

    // Set canonical handle.
    await (tx as any)[model].update({
      where: { id: args.ownerId },
      data: { handle: desiredKey },
      select: { id: true },
    });

    return desiredKey;
  });
}