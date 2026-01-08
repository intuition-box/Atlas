import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { ApiResponse } from "@/types/api";

import { db } from "@/lib/database";
import { requireCommunityRole, requireUser } from "@/lib/permissions";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type StatusError = Error & { status?: number };

function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json<ApiResponse<T>>(
    { success: true, data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function jsonFail(status: number, message: string, details?: unknown) {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: { code: status, message, details } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

const Body = z.object({
  attestationId: z.string().min(1),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireCsrf(req);

    const { userId } = await requireUser();

    const json = await req.json().catch(() => null);
    if (!json) return jsonFail(400, "Invalid JSON body");

    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const { attestationId, reason } = parsed.data;

    const att = await db.attestation.findUnique({
      where: { id: attestationId },
      select: {
        id: true,
        communityId: true,
        fromUserId: true,
        revokedAt: true,
        supersededById: true,
      },
    });

    if (!att) return jsonFail(404, "Attestation not found");

    // No-op retract is OK and idempotent.
    if (att.revokedAt) {
      return jsonOk({ ok: true, revoked: true, alreadyRevoked: true });
    }

    // Only allow retracting an active attestation.
    if (att.supersededById) {
      return jsonFail(409, "This attestation was superseded and cannot be retracted.");
    }

    const isAuthor = att.fromUserId === userId;

    if (!isAuthor) {
      // Moderation: allow community staff to retract.
      // For your numeric ranking (OWNER=0, ADMIN=1, MODERATOR=2, MEMBER=3),
      // MODERATOR and above means role <= MODERATOR.
      await requireCommunityRole({ userId, communityId: att.communityId, atLeast: "MODERATOR" });
    }

    await db.$transaction(async (tx) => {
      await tx.attestation.update({
        where: { id: attestationId },
        data: {
          revokedAt: new Date(),
          revokedByUserId: userId,
          revokedReason: reason ?? null,
        },
      });

      await tx.activityEvent.create({
        data: {
          communityId: att.communityId,
          actorId: userId,
          type: "ATTESTATION_RETRACTED",
          metadata: {
            attestationId,
            reason: reason ?? null,
          },
        },
      });
    });

    return jsonOk({ ok: true, revoked: true });
  } catch (err) {
    const e = err as StatusError;

    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}