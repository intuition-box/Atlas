import "server-only";

import { db } from "@/lib/db";
import type { HandleOwnerType, HandleStatus } from "@prisma/client";

/**
 * Normalizes a user-supplied handle string.
 *
 * - trims whitespace
 * - strips leading '@'
 * - lowercases (handles are case-insensitive)
 */
export function normalizeHandleKey(raw: string): string {
  const trimmed = raw.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutAt.trim().toLowerCase();
}

const HANDLE_RE = /^[a-z0-9_-]{3,24}$/;

function shouldTryHandleFirst(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("@")) return true;
  const normalized = normalizeHandleKey(trimmed);
  // If it looks like a valid handle (short + allowed charset), try handle lookup first.
  return HANDLE_RE.test(normalized);
}

async function resolveActiveHandleOwner(args: {
  handle: string;
  ownerType: HandleOwnerType;
}): Promise<string | null> {
  const h = await db.handle.findUnique({
    where: { handle: args.handle },
    select: { status: true, ownerType: true, ownerId: true },
  });

  if (!h || h.status !== "ACTIVE" || h.ownerType !== args.ownerType || !h.ownerId) return null;
  return h.ownerId;
}

/**
 * Resolve a user ID from either:
 * - a direct User.id
 * - an ACTIVE Handle that points to a USER owner
 *
 * Returns null if not resolvable.
 */
export async function resolveUserIdFromIdOrHandle(raw: string): Promise<string | null> {
  const key = raw.trim();
  if (!key) return null;

  const tryHandleFirst = shouldTryHandleFirst(key);

  if (tryHandleFirst) {
    const ownerId = await resolveActiveHandleOwner({
      handle: normalizeHandleKey(key),
      ownerType: "USER",
    });
    if (ownerId) return ownerId;
  }

  // Direct ID lookup (keeps existing /u/<id> links working)
  const byId = await db.user.findUnique({ where: { id: key }, select: { id: true } });
  if (byId) return byId.id;

  // If we didn't try handle first, try it as a fallback.
  if (!tryHandleFirst) {
    const ownerId = await resolveActiveHandleOwner({
      handle: normalizeHandleKey(key),
      ownerType: "USER",
    });
    if (ownerId) return ownerId;
  }

  return null;
}

/**
 * Resolve a community ID from an ACTIVE Handle that points to a COMMUNITY owner.
 *
 * Returns null if not resolvable.
 */
export async function resolveCommunityIdFromHandle(raw: string): Promise<string | null> {
  const key = raw.trim();
  if (!key) return null;

  return resolveActiveHandleOwner({
    handle: normalizeHandleKey(key),
    ownerType: "COMMUNITY",
  });
}

/**
 * Get the ACTIVE handle string for an owner, if one exists.
 */
export async function getActiveHandleForOwner(args: {
  ownerType: HandleOwnerType;
  ownerId: string;
}): Promise<string | null> {
  const row = await db.handle.findFirst({
    where: { status: "ACTIVE", ownerType: args.ownerType, ownerId: args.ownerId },
    select: { handle: true },
  });
  return row?.handle ?? null;
}

/**
 * Guardrail helpers for future handle mutation logic.
 *
 * These are NOT wired up yet; they exist so the policy is centralized.
 */
export const HANDLE_POLICY = {
  reclaimWindowDays: 7,
  publicReuseAfterDays: 30,
} as const;

export function isResolvableStatus(status: HandleStatus): boolean {
  return status === "ACTIVE";
}