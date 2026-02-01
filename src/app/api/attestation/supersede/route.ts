import type { NextRequest } from "next/server";
import { z } from "zod";

import {
  AttestationType,
  MembershipRole,
  MembershipStatus,
  ScoringType,
} from "@prisma/client";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { requireCsrf } from "@/lib/security/csrf";
import { recomputeMemberScores } from "@/lib/scoring";

export const runtime = "nodejs";

const BodySchema = z
  .object({
    attestationId: z.string().trim().min(1),
    // New values to apply to the replacement attestation.
    // Semantics:
    // - undefined: keep existing
    // - null: clear
    // - value: set
    note: z.union([z.string().trim().min(1).max(500), z.null()]).optional(),
    confidence: z.union([z.number().finite().min(0).max(1), z.null()]).optional(),
  })
  .refine((v) => v.note !== undefined || v.confidence !== undefined, {
    message: "Nothing to change",
    path: ["note"],
  });

type SupersedeOk = {
  attestation: {
    id: string;
    supersedesId: string;
  };
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

    const { attestationId, note, confidence } = parsed.data;

    const existing = await db.attestation.findUnique({
      where: { id: attestationId },
      select: {
        id: true,
        communityId: true,
        fromUserId: true,
        toUserId: true,
        type: true,
        note: true,
        confidence: true,
        revokedAt: true,
        supersededById: true,
      },
    });

    if (!existing) {
      return errJson({ code: "NOT_FOUND", message: "Attestation not found", status: 404 });
    }

    if (existing.revokedAt) {
      return errJson({ code: "CONFLICT", message: "Attestation is revoked", status: 409 });
    }

    if (existing.supersededById) {
      return errJson({
        code: "CONFLICT",
        message: "Attestation is already superseded",
        status: 409,
      });
    }

    // Author can supersede; moderators+ can supersede for moderation.
    const isAuthor = existing.fromUserId === userId;

    const actorMembership = await db.membership.findUnique({
      where: { userId_communityId: { userId, communityId: existing.communityId } },
      select: { id: true, role: true, status: true },
    });

    if (!actorMembership || actorMembership.status !== MembershipStatus.APPROVED) {
      return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    const canModerate = MOD_ROLES.includes(actorMembership.role);
    if (!isAuthor && !canModerate) {
      return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
    }

    // Target must be an approved member too.
    const targetMembership = await db.membership.findUnique({
      where: {
        userId_communityId: { userId: existing.toUserId, communityId: existing.communityId },
      },
      select: { id: true, status: true },
    });

    if (!targetMembership || targetMembership.status !== MembershipStatus.APPROVED) {
      return errJson({ code: "FORBIDDEN", message: "Target user is not a member", status: 403 });
    }

    const nextType: AttestationType = existing.type;

    const nextNote =
      note === undefined ? (existing.note ?? null) : note === null ? null : note;

    const nextConfidence =
      confidence === undefined
        ? (existing.confidence ?? null)
        : confidence === null
          ? null
          : confidence;

    // If nothing changes after defaults, avoid creating a no-op replacement.
    if (nextNote === (existing.note ?? null) && nextConfidence === (existing.confidence ?? null)) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Nothing to change",
        status: 400,
      });
    }

    const now = new Date();

    const created = await db.$transaction(async (tx) => {
      const replacement = await tx.attestation.create({
        data: {
          communityId: existing.communityId,
          fromUserId: existing.fromUserId,
          toUserId: existing.toUserId,
          type: nextType,
          note: nextNote,
          confidence: nextConfidence,
        },
        select: { id: true },
      });

      await tx.attestation.update({
        where: { id: existing.id },
        data: { supersededById: replacement.id },
        select: { id: true },
      });

      await tx.membership.updateMany({
        where: { id: actorMembership.id },
        data: { lastActiveAt: now },
      });

      await tx.membership.updateMany({
        where: { id: targetMembership.id },
        data: { lastActiveAt: now },
      });

      await tx.scoringEvent.create({
        data: {
          communityId: existing.communityId,
          actorId: userId,
          type: ScoringType.ATTESTATION_SUPERSEDED,
          metadata: {
            fromAttestationId: existing.id,
            toAttestationId: replacement.id,
          },
        },
        select: { id: true },
      });

      return replacement;
    });

    // Best-effort: keep scoring in sync without risking the primary write path.
    try {
      await Promise.all([
        recomputeMemberScores({ communityId: existing.communityId, userId: existing.fromUserId }),
        recomputeMemberScores({ communityId: existing.communityId, userId: existing.toUserId }),
      ]);
    } catch {
      // Ignore scoring failures; the core supersede is already committed.
    }

    return okJson<SupersedeOk>({
      attestation: { id: created.id, supersedesId: existing.id },
    });
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}