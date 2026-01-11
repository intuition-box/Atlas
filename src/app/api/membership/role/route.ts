import {
  MembershipRole,
  MembershipStatus,
  Prisma,
  ScoringType,
} from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
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
    membershipId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    communityId: z.string().min(1).optional(),
    role: z.nativeEnum(MembershipRole),
  })
  .refine(
    (v) => Boolean(v.membershipId || (v.userId && v.communityId)),
    {
      message: "membershipId or (userId + communityId) is required",
      path: ["membershipId"],
    },
  )
  .refine((v) => ALLOWED_ROLES.has(v.role), {
    message: "Role is not assignable via this endpoint",
    path: ["role"],
  })
  .refine((v) => v.role !== MembershipRole.OWNER, {
    // Ownership transfer should be its own explicit flow.
    message: "OWNER role cannot be assigned via this endpoint",
    path: ["role"],
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
                userId: input.userId!,
                communityId: input.communityId!,
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
      const typeFromEnum = (name: string): ScoringType | undefined =>
        (ScoringType as any)[name] as ScoringType | undefined;

      const type =
        typeFromEnum("MEMBERSHIP_ROLE_CHANGED") ??
        typeFromEnum("ROLE_CHANGED") ??
        typeFromEnum("MEMBERSHIP_CHANGED");

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
