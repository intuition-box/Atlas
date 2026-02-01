import { z } from "zod";
import { AttestationType, MembershipStatus, ScoringType } from "@prisma/client";

import { db } from "@/lib/db/client";
import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { resolveCommunityIdFromHandle, resolveUserIdFromHandle } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";
import type { NextRequest } from "next/server";

export const runtime = "nodejs";

const BodySchema = z.object({
  // Prefer ids when provided; handles are supported for convenience.
  communityId: z.string().trim().min(1).optional(),
  communityHandle: z.string().trim().min(1).optional(),

  toUserId: z.string().trim().min(1).optional(),
  toHandle: z.string().trim().min(1).optional(),

  // Optional note shown to the receiver / community.
  note: z.string().trim().min(1).max(500).optional(),

  // Attestation type (Prisma enum).
  type: z.nativeEnum(AttestationType),
});

type CreateAttestationOk = {
  attestation: {
    id: string;
  };
};

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

    const { note, type } = parsed.data;

    let communityId = parsed.data.communityId ?? null;
    if (!communityId && parsed.data.communityHandle) {
      const resolved = await resolveCommunityIdFromHandle(parsed.data.communityHandle);
      if (!resolved.ok) return errJson(resolved.error);
      communityId = resolved.value;
    }

    let toUserId = parsed.data.toUserId ?? null;
    if (!toUserId && parsed.data.toHandle) {
      const resolved = await resolveUserIdFromHandle(parsed.data.toHandle);
      if (!resolved.ok) return errJson(resolved.error);
      toUserId = resolved.value;
    }

    if (!communityId || !toUserId) {
      return errJson({ code: "INVALID_REQUEST", message: "Invalid request", status: 400 });
    }

    if (toUserId === userId) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "You can't attest yourself",
        status: 400,
      });
    }

    // Both author and target must be approved members (prevents abuse / drive-by attestations).
    const [fromMembership, toMembership] = await Promise.all([
      db.membership.findUnique({
        where: { userId_communityId: { userId, communityId } },
        select: { id: true, status: true },
      }),
      db.membership.findUnique({
        where: { userId_communityId: { userId: toUserId, communityId } },
        select: { id: true, status: true },
      }),
    ]);

    if (!fromMembership || fromMembership.status !== MembershipStatus.APPROVED) {
      return errJson({ code: "FORBIDDEN", message: "You must be a member to attest", status: 403 });
    }

    if (!toMembership || toMembership.status !== MembershipStatus.APPROVED) {
      return errJson({ code: "FORBIDDEN", message: "Target user is not a member", status: 403 });
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const recent = await db.attestation.findFirst({
      where: {
        communityId,
        fromUserId: userId,
        toUserId,
        type,
        createdAt: { gte: since },
      },
      select: { id: true },
    });

    if (recent) {
      return errJson({
        code: "CONFLICT",
        message: "You already attested this user recently",
        status: 409,
      });
    }

    const now = new Date();

    const created = await db.$transaction(async (tx) => {
      const attestation = await tx.attestation.create({
        data: {
          communityId,
          fromUserId: userId,
          toUserId,
          note: note ?? null,
          type,
        },
        select: { id: true },
      });

      // Track scoring/engagement.
      await tx.scoringEvent.create({
        data: {
          communityId,
          actorId: userId,
          type: ScoringType.ATTESTED,
          metadata: {
            toUserId,
            attestationId: attestation.id,
            attestationType: type,
          },
        },
        select: { id: true },
      });

      // Keep memberships warm.
      await tx.membership.updateMany({
        where: { id: fromMembership.id },
        data: { lastActiveAt: now },
      });

      await tx.membership.updateMany({
        where: { id: toMembership.id },
        data: { lastActiveAt: now },
      });

      return attestation;
    });

    return okJson<CreateAttestationOk>({ attestation: { id: created.id } });
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}
