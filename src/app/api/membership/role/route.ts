import {
  MembershipRole,
  MembershipStatus,
  Prisma,
  ScoringType,
} from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveCommunityIdFromHandle, resolveUserIdFromHandle } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type SetMembershipRoleOk = {
  membership: {
    id: string;
    userId: string;
    communityId: string;
    role: MembershipRole;
  };
  changed: boolean;
};

const ALLOWED_ROLES = new Set<MembershipRole>([
  MembershipRole.ADMIN,
  MembershipRole.MODERATOR,
  MembershipRole.MEMBER,
]);

const SetMembershipRoleSchema = z
  .object({
    membershipId: z.string().trim().min(1).optional(),

    // Prefer ids; allow handles for user-facing flows.
    userId: z.string().trim().min(1).optional(),
    userHandle: z.string().trim().min(1).optional(),

    communityId: z.string().trim().min(1).optional(),
    communityHandle: z.string().trim().min(1).optional(),

    role: z.nativeEnum(MembershipRole),
  })
  .superRefine((v, ctx) => {
    // Addressing: membershipId OR (user + community)
    if (!v.membershipId) {
      const hasUser = Boolean(v.userId || v.userHandle);
      const hasCommunity = Boolean(v.communityId || v.communityHandle);
      if (!hasUser || !hasCommunity) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["membershipId"],
          message: "membershipId or (user + community) is required",
        });
      }
    }

    if (!ALLOWED_ROLES.has(v.role)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: "Role is not assignable via this endpoint",
      });
    }

    // Ownership transfer should be its own explicit flow.
    if (v.role === MembershipRole.OWNER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["role"],
        message: "OWNER role cannot be assigned via this endpoint",
      });
    }
  });

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const actorId = session?.user?.id;

    if (!actorId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const csrf = await requireCsrf(req);
    if (csrf instanceof Response) return csrf;

    const raw = await req.json().catch(() => null);
    const parsed = SetMembershipRoleSchema.safeParse(raw);

    if (!parsed.success) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Invalid request",
        status: 400,
        issues: parsed.error.issues.map((iss) => ({
          path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
          message: iss.message,
        })),
      });
    }

    const input = parsed.data;

    let userId = input.userId ?? null;
    let communityId = input.communityId ?? null;

    if (!input.membershipId) {
      if (!communityId && input.communityHandle) {
        const resolved = await resolveCommunityIdFromHandle(input.communityHandle);
        if (!resolved.ok) return errJson(resolved.error);
        communityId = resolved.value;
      }

      if (!userId && input.userHandle) {
        const resolved = await resolveUserIdFromHandle(input.userHandle);
        if (!resolved.ok) return errJson(resolved.error);
        userId = resolved.value;
      }
    }

    // From here on, if we are not addressing by membershipId, ids must be present.
    const targetUserId = input.membershipId ? null : userId;
    const targetCommunityId = input.membershipId ? null : communityId;

    if (!input.membershipId && (!targetUserId || !targetCommunityId)) {
      return errJson({ code: "INVALID_REQUEST", message: "Invalid request", status: 400 });
    }

    const result = await db.$transaction(async (tx) => {
      const membership = input.membershipId
        ? await tx.membership.findUnique({
            where: { id: input.membershipId },
            select: {
              id: true,
              userId: true,
              communityId: true,
              role: true,
              status: true,
            },
          })
        : await tx.membership.findUnique({
            where: {
              userId_communityId: {
                userId: targetUserId!,
                communityId: targetCommunityId!,
              },
            },
            select: {
              id: true,
              userId: true,
              communityId: true,
              role: true,
              status: true,
            },
          });

      if (!membership) {
        return { kind: "not_found" } as const;
      }

      // Actor must be an approved OWNER of the community.
      // (Admins can be added later if you want; OWNER-only is safest by default.)
      const actorMembership = await tx.membership.findUnique({
        where: {
          userId_communityId: {
            userId: actorId,
            communityId: membership.communityId,
          },
        },
        select: { status: true, role: true },
      });

      if (!actorMembership || actorMembership.status !== MembershipStatus.APPROVED) {
        return { kind: "forbidden" } as const;
      }

      if (actorMembership.role !== MembershipRole.OWNER) {
        return { kind: "forbidden" } as const;
      }

      // Safety: don't mutate OWNER memberships here (ownership transfer should be explicit).
      if (membership.role === MembershipRole.OWNER) {
        return { kind: "owner_target_forbidden" } as const;
      }

      if (membership.role === input.role) {
        return { kind: "ok", membership: { ...membership, role: input.role }, changed: false } as const;
      }

      const prevRole = membership.role;

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data: { role: input.role },
        select: {
          id: true,
          userId: true,
          communityId: true,
          role: true,
        },
      });

      // Audit / preferences feed (best-effort): record a membership role change.
      const scoringTypes = ScoringType as unknown as Record<string, ScoringType>;
      const type =
        scoringTypes.MEMBERSHIP_ROLE_CHANGED ??
        scoringTypes.ROLE_CHANGED ??
        scoringTypes.MEMBERSHIP_CHANGED;

      if (type) {
        await tx.scoringEvent.create({
          data: {
            communityId: updated.communityId,
            actorId,
            type,
            metadata: {
              subjectUserId: updated.userId,
              fromRole: prevRole,
              toRole: updated.role,
            },
          },
          select: { id: true },
        });
      }

      return { kind: "ok", membership: updated, changed: true } as const;
    });

    if (result.kind === "not_found") {
      return errJson({ code: "NOT_FOUND", message: "Membership not found", status: 404 });
    }

    if (result.kind === "owner_target_forbidden") {
      return errJson({
        code: "FORBIDDEN",
        message: "Owner role changes require a dedicated ownership transfer flow",
        status: 403,
      });
    }

    if (result.kind === "forbidden") {
      return errJson({ code: "FORBIDDEN", message: "Insufficient permissions", status: 403 });
    }

    return okJson<SetMembershipRoleOk>({
      membership: {
        id: result.membership.id,
        userId: result.membership.userId,
        communityId: result.membership.communityId,
        role: result.membership.role,
      },
      changed: result.changed,
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "Membership not found", status: 404 });
    }

    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}
