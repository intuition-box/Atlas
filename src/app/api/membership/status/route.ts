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

type SetMembershipStatusOk = {
  membership: {
    id: string;
    userId: string;
    communityId: string;
    status: MembershipStatus;
  };
  changed: boolean;
};

const SetMembershipStatusSchema = z
  .object({
    membershipId: z.string().min(1).optional(),
    userId: z.string().min(1).optional(),
    communityId: z.string().min(1).optional(),
    status: z.nativeEnum(MembershipStatus),
  })
  .refine(
    (v) => Boolean(v.membershipId || (v.userId && v.communityId)),
    {
      message: "membershipId or (userId + communityId) is required",
      path: ["membershipId"],
    },
  );

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
    const parsed = SetMembershipStatusSchema.safeParse(raw);

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
    const now = new Date();

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
              approvedAt: true,
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
              approvedAt: true,
            },
          });

      if (!membership) {
        return { kind: "not_found" } as const;
      }

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

      if (
        actorMembership.role !== MembershipRole.OWNER &&
        actorMembership.role !== MembershipRole.ADMIN
      ) {
        return { kind: "forbidden" } as const;
      }

      // Safety: do not allow banning the OWNER membership.
      if (input.status === MembershipStatus.BANNED && membership.role === MembershipRole.OWNER) {
        return { kind: "owner_ban_forbidden" } as const;
      }

      if (membership.status === input.status) {
        return { kind: "ok", membership, changed: false } as const;
      }

      const data: Prisma.MembershipUpdateInput = {
        status: input.status,
      };

      // Keep semantics minimal and schema-safe: only set approvedAt when approving.
      if (input.status === MembershipStatus.APPROVED && !membership.approvedAt) {
        data.approvedAt = now;
      }

      const prevStatus = membership.status;

      const updated = await tx.membership.update({
        where: { id: membership.id },
        data,
        select: {
          id: true,
          userId: true,
          communityId: true,
          status: true,
        },
      });

      // Audit / preferences feed (best-effort): record a membership status change.
      // We resolve enum members defensively so this route won’t break if naming differs.
      const typeFromEnum = (name: string): ScoringType | undefined =>
        (ScoringType as any)[name] as ScoringType | undefined;

      const type =
        updated.status === MembershipStatus.BANNED
          ? (typeFromEnum("MEMBERSHIP_BANNED") ?? typeFromEnum("BANNED"))
          : prevStatus === MembershipStatus.BANNED && updated.status === MembershipStatus.APPROVED
            ? (typeFromEnum("MEMBERSHIP_UNBANNED") ?? typeFromEnum("UNBANNED"))
            : (typeFromEnum("MEMBERSHIP_STATUS_CHANGED") ?? typeFromEnum("STATUS_CHANGED"));

      if (type) {
        await tx.scoringEvent.create({
          data: {
            communityId: updated.communityId,
            actorId,
            type,
            metadata: {
              subjectUserId: updated.userId,
              fromStatus: prevStatus,
              toStatus: updated.status,
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

    if (result.kind === "owner_ban_forbidden") {
      return errJson({ code: "FORBIDDEN", message: "You can't ban the owner.", status: 403 });
    }

    if (result.kind === "forbidden") {
      return errJson({ code: "FORBIDDEN", message: "Insufficient permissions", status: 403 });
    }

    return okJson<SetMembershipStatusOk>({
      membership: {
        id: result.membership.id,
        userId: result.membership.userId,
        communityId: result.membership.communityId,
        status: result.membership.status,
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
