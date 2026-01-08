import "server-only";

import { auth } from "@/lib/auth";
import { db } from "@/lib/database";
import { MembershipRole, MembershipStatus } from "@prisma/client";

// Lower index = more privileges.
// NOTE: `MODERATOR` may be introduced later in the Prisma enum; we include it here for forward-compat.
const ROLE_ORDER = ["OWNER", "ADMIN", "MODERATOR", "MEMBER"] as const;

type AnyRole = MembershipRole | "MODERATOR";

type HttpError = Error & { status: number };

function fail(status: number, message: string): never {
  const err = new Error(message) as HttpError;
  err.name = "PermissionError";
  err.status = status;
  throw err;
}

function roleIndex(role: AnyRole): number {
  const idx = ROLE_ORDER.indexOf(role as (typeof ROLE_ORDER)[number]);
  return idx === -1 ? ROLE_ORDER.length : idx;
}

export function hasAtLeastRole(current: AnyRole, min: AnyRole): boolean {
  return roleIndex(current) <= roleIndex(min);
}

export async function requireUser() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    fail(401, "Please sign in.");
  }

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