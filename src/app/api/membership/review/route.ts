import type { NextRequest } from "next/server";
import { z } from "zod";

import { MembershipRole, MembershipStatus } from "@prisma/client";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import { requireCsrf } from "@/lib/security/csrf";
import { recomputeMemberScores } from "@/lib/scoring";

export const runtime = "nodejs";

const BodySchema = z.object({
  applicationId: z.string().trim().min(1),
  decision: z.enum(["APPROVE", "REJECT"] as const),
  note: z.string().trim().min(1).max(500).optional(),
});

type ReviewOk = {
  membership: {
    id: string;
    status: MembershipStatus;
  };
  alreadyReviewed: boolean;
};

const REVIEW_ROLES: MembershipRole[] = [
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

    const { applicationId, decision, note } = parsed.data;

    const app = await db.application.findUnique({
      where: { id: applicationId },
      select: {
        id: true,
        communityId: true,
        userId: true,
        status: true,
      },
    });

    if (!app) {
      return errJson({ code: "NOT_FOUND", message: "Application not found", status: 404 });
    }

    // Reviewer must be an approved member with review privileges.
    const reviewer = await db.membership.findFirst({
      where: {
        communityId: app.communityId,
        userId,
        status: MembershipStatus.APPROVED,
      },
      select: { id: true, role: true },
    });

    if (!reviewer || !REVIEW_ROLES.includes(reviewer.role)) {
      return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    // Idempotency: if already reviewed, return ok only when the decision matches.
    if (app.status !== MembershipStatus.PENDING) {
      const desired =
        decision === "APPROVE" ? MembershipStatus.APPROVED : MembershipStatus.REJECTED;

      if (app.status === desired) {
        return okJson<ReviewOk>({
          membership: { id: app.id, status: app.status },
          alreadyReviewed: true,
        });
      }

      return errJson({
        code: "CONFLICT",
        message: "Application is already reviewed",
        status: 409,
      });
    }

    const now = new Date();
    const nextStatus: MembershipStatus =
      decision === "APPROVE" ? MembershipStatus.APPROVED : MembershipStatus.REJECTED;

    const updated = await db.$transaction(async (tx) => {
      const updatedApp = await tx.application.update({
        where: { id: app.id },
        data: {
          status: nextStatus,
          reviewedAt: now,
          reviewerId: userId,
          reviewNote: note ?? null,
        },
        select: { id: true, status: true },
      });

      // Keep membership aligned with the decision.
      if (decision === "APPROVE") {
        await tx.membership.upsert({
          where: {
            userId_communityId: {
              userId: app.userId,
              communityId: app.communityId,
            },
          },
          create: {
            userId: app.userId,
            communityId: app.communityId,
            role: MembershipRole.MEMBER,
            status: MembershipStatus.APPROVED,
            approvedAt: now,
            lastActiveAt: now,
          },
          update: {
            status: MembershipStatus.APPROVED,
            approvedAt: now,
          },
          select: { id: true },
        });
      } else {
        // Reject: do not create a membership row; if one exists, mark it rejected.
        await tx.membership.updateMany({
          where: {
            userId: app.userId,
            communityId: app.communityId,
          },
          data: {
            status: MembershipStatus.REJECTED,
          },
        });
      }

      // Keep reviewer warm.
      await tx.membership.updateMany({
        where: { id: reviewer.id },
        data: { lastActiveAt: now },
      });

      return updatedApp;
    });

    if (decision === "APPROVE") {
      try {
        await recomputeMemberScores({ communityId: app.communityId, userId: app.userId });
      } catch {
        // Ignore scoring failures; approval is already committed.
      }
    }

    return okJson<ReviewOk>({
      membership: { id: updated.id, status: updated.status },
      alreadyReviewed: false,
    });
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}
