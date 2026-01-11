import type { NextRequest } from "next/server";
import { z } from "zod";

import { MembershipRole, MembershipStatus, ScoringType } from "@prisma/client";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

const BodySchema = z.object({
  attestationId: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(200).optional(),
});

type RetractOk = {
  attestation: { id: string };
  alreadyRevoked: boolean;
};

const MOD_ROLES: MembershipRole[] = [
  MembershipRole.OWNER,
  MembershipRole.ADMIN,
  MembershipRole.MODERATOR,
];

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const csrf = await requireCsrf(req);
    if (csrf instanceof Response) return csrf;

    const body = await req.json().catch(() => null);
    const parsed = await BodySchema.safeParseAsync(body);

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

    const { attestationId, reason } = parsed.data;

    const row = await db.attestation.findUnique({
      where: { id: attestationId },
      select: {
        id: true,
        communityId: true,
        fromUserId: true,
        revokedAt: true,
        supersededById: true,
      },
    });

    if (!row) {
      return errJson({ code: "NOT_FOUND", message: "Attestation not found", status: 404 });
    }

    if (row.revokedAt) {
      return okJson<RetractOk>({ attestation: { id: row.id }, alreadyRevoked: true });
    }

    if (row.supersededById) {
      return errJson({
        code: "CONFLICT",
        message: "Attestation can’t be retracted (superseded)",
        status: 409,
      });
    }

    // Author can retract; moderators+ can retract for moderation.
    const isAuthor = row.fromUserId === userId;

    const actorMembership = await db.membership.findUnique({
      where: { userId_communityId: { userId, communityId: row.communityId } },
      select: { id: true, role: true, status: true },
    });

    if (!actorMembership || actorMembership.status !== MembershipStatus.APPROVED) {
      return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    const canModerate = MOD_ROLES.includes(actorMembership.role);
    if (!isAuthor && !canModerate) {
      return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    const now = new Date();

    await db.$transaction(async (tx) => {
      await tx.attestation.update({
        where: { id: row.id },
        data: {
          revokedAt: now,
          revokedByUserId: userId,
          revokedReason: reason ?? null,
        },
        select: { id: true },
      });

      await tx.membership.updateMany({
        where: { id: actorMembership.id },
        data: { lastActiveAt: now },
      });

      // Audit / preferences feed.
      await tx.scoringEvent.create({
        data: {
          communityId: row.communityId,
          actorId: userId,
          type: ScoringType.ATTESTATION_RETRACTED,
          metadata: {
            attestationId: row.id,
            reason: reason ?? null,
          },
        },
        select: { id: true },
      });
    });

    return okJson<RetractOk>({ attestation: { id: row.id }, alreadyRevoked: false });
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}
