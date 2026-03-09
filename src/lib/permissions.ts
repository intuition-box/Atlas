import "server-only";

import { db } from "@/lib/db/client";
import { requireAuth } from "@/lib/auth/policy";
import { MembershipRole, MembershipStatus } from "@prisma/client";

// Re-export shared schemas and helpers for server consumers
export {
  PermissionKeySchema,
  RolePermissionsSchema,
  CONFIGURABLE_ROLES,
  DEFAULT_PERMISSIONS,
  PERMISSION_LABELS,
  hasPermission,
  type PermissionKey,
  type RolePermissions,
  type ConfigurableRole,
} from "@/lib/permissions-shared";

import type { PermissionKey } from "@/lib/permissions-shared";
import { hasPermission } from "@/lib/permissions-shared";

// ─── Role hierarchy ──────────────────────────────────────────────────────────
// Lower index = more privileges.
const ROLE_ORDER = ["OWNER", "ADMIN", "MODERATOR", "MEMBER"] as const;

type AnyRole = MembershipRole | "MODERATOR";

// ─── Error class ──────────────────────────────────────────────────────────────

export class PermissionError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "PermissionError";
    this.status = status;
  }
}

export function isPermissionError(e: unknown): e is PermissionError {
  return e instanceof PermissionError;
}

function fail(status: number, message: string): never {
  throw new PermissionError(status, message);
}

// ─── Role helpers ─────────────────────────────────────────────────────────────

function roleIndex(role: AnyRole): number {
  const idx = ROLE_ORDER.indexOf(role as (typeof ROLE_ORDER)[number]);
  return idx === -1 ? ROLE_ORDER.length : idx;
}

export function hasAtLeastRole(current: AnyRole, min: AnyRole): boolean {
  return roleIndex(current) <= roleIndex(min);
}

// ─── Server-only helpers ──────────────────────────────────────────────────────

export async function requireUser() {
  const { userId, session } = await requireAuth();
  return { userId, session };
}

async function getMembership(params: { userId: string; communityId: string }) {
  return db.membership.findUnique({
    where: {
      userId_communityId: {
        userId: params.userId,
        communityId: params.communityId,
      },
    },
    select: {
      id: true,
      role: true,
      status: true,
      userId: true,
      communityId: true,
    },
  });
}

export async function requireApprovedMember(params: {
  userId: string;
  communityId: string;
}) {
  const membership = await getMembership(params);

  if (!membership) {
    fail(403, "Not a member.");
  }

  if (membership.status !== MembershipStatus.APPROVED) {
    fail(403, "Not approved.");
  }

  return membership;
}

export async function requireCommunityRole(params: {
  userId: string;
  communityId: string;
  minRole: MembershipRole | "MODERATOR"; // min required role (OWNER highest)
}) {
  const membership = await requireApprovedMember({
    userId: params.userId,
    communityId: params.communityId,
  });

  if (!hasAtLeastRole(membership.role, params.minRole)) {
    fail(403, "You don't have access.");
  }

  return membership;
}

/**
 * Require a specific permission for the current membership.
 *
 * Fetches the community's permissions JSON and checks against the member's role.
 * Throws PermissionError(403) if the permission is not granted.
 */
export async function requirePermission(params: {
  userId: string;
  communityId: string;
  permission: PermissionKey;
}) {
  const membership = await requireApprovedMember({
    userId: params.userId,
    communityId: params.communityId,
  });

  const community = await db.community.findUnique({
    where: { id: params.communityId },
    select: { permissions: true },
  });

  if (!hasPermission(membership.role, params.permission, community?.permissions)) {
    fail(403, "You don't have this permission.");
  }

  return membership;
}
