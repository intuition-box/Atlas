import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { ApiResponse } from "@/types/api";

import { db } from "@/lib/database";
import { requireApprovedMember, requireUser } from "@/lib/permissions";
import { recomputeMemberScores } from "@/lib/scoring";
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
  note: z.string().trim().max(500).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
});

export async function POST(req: NextRequest) {
  try {
    await requireCsrf(req);

    const { userId: fromUserId } = await requireUser();

    const json = await req.json().catch(() => null);
    if (!json) return jsonFail(400, "Invalid JSON body");

    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const { attestationId } = parsed.data;
    const note = parsed.data.note ?? undefined;
    const confidence = parsed.data.confidence ?? undefined;

    const existing = await db.attestation.findUnique({
      where: { id: attestationId },
      select: {
        id: true,
        communityId: true,
        fromUserId: true,
        toUserId: true,
        type: true,
        revokedAt: true,
        supersededById: true,
      },
    });

    if (!existing) return jsonFail(404, "Attestation not found");

    if (existing.fromUserId !== fromUserId) {
      return jsonFail(403, "Only the author can supersede an attestation.");
    }

    if (existing.revokedAt) {
      return jsonFail(409, "This attestation was retracted and cannot be superseded.");
    }

    if (existing.supersededById) {
      return jsonFail(409, "This attestation was already superseded.");
    }

    // MVP rule: both must be approved members of the same community
    await requireApprovedMember({ userId: fromUserId, communityId: existing.communityId });
    await requireApprovedMember({ userId: existing.toUserId, communityId: existing.communityId });

    const created = await db.$transaction(async (tx) => {
      const next = await tx.attestation.create({
        data: {
          communityId: existing.communityId,
          fromUserId,
          toUserId: existing.toUserId,
          type: existing.type,
          note: note === undefined ? null : note,
          confidence: confidence === undefined ? null : confidence,
        },
        select: { id: true },
      });

      await tx.attestation.update({
        where: { id: existing.id },
        data: { supersededById: next.id },
      });

      await tx.activityEvent.create({
        data: {
          communityId: existing.communityId,
          actorId: fromUserId,
          subjectUserId: existing.toUserId,
          type: "ATTESTATION_SUPERSEDED",
          metadata: {
            fromAttestationId: existing.id,
            toAttestationId: next.id,
          },
        },
      });

      // Keep lastActiveAt warm for orbit “recency”
      await tx.membership.update({
        where: {
          userId_communityId: {
            userId: fromUserId,
            communityId: existing.communityId,
          },
        },
        data: { lastActiveAt: new Date() },
      });

      return next;
    });

    // Recompute scores for both sides
    await recomputeMemberScores({ communityId: existing.communityId, userId: fromUserId });
    await recomputeMemberScores({ communityId: existing.communityId, userId: existing.toUserId });

    return jsonOk({ ok: true, superseded: true, newAttestationId: created.id });
  } catch (err) {
    const e = err as StatusError;

    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}