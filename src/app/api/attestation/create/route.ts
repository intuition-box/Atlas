import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import type { ApiResponse } from "@/types/api";

import { db } from "@/lib/database";
import { requireApprovedMember, requireUser } from "@/lib/permissions";
import { recomputeMemberScores } from "@/lib/scoring";
import { requireCsrf } from "@/lib/security/csrf";
import { AttestationCreateSchema } from "@/lib/validation/attestation";

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

export async function POST(req: NextRequest) {
  try {
    await requireCsrf(req);

    const { userId: fromUserId } = await requireUser();

    const json = await req.json().catch(() => null);
    if (!json) return jsonFail(400, "Invalid JSON body");

    const parsed = AttestationCreateSchema.safeParse(json);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const body = parsed.data;

    if (body.toUserId === fromUserId) {
      return jsonFail(400, "You can't attest to yourself.");
    }

    // MVP rule: both must be approved members of the same community
    await requireApprovedMember({ userId: fromUserId, communityId: body.communityId });
    await requireApprovedMember({ userId: body.toUserId, communityId: body.communityId });

    // Simple spam guard: prevent same (from,to,type) within 24h
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dup = await db.attestation.findFirst({
      where: {
        communityId: body.communityId,
        fromUserId,
        toUserId: body.toUserId,
        type: body.type,
        createdAt: { gte: since },
      },
      select: { id: true },
    });

    if (dup) {
      return jsonFail(409, "You already created this attestation recently.");
    }

    await db.$transaction(async (tx) => {
      await tx.attestation.create({
        data: {
          communityId: body.communityId,
          fromUserId,
          toUserId: body.toUserId,
          type: body.type,
          note: body.note ?? null,
          confidence: body.confidence ?? null,
        },
      });

      await tx.activityEvent.create({
        data: {
          communityId: body.communityId,
          actorId: fromUserId,
          subjectUserId: body.toUserId,
          type: "ATTESTED",
          metadata: ({ type: body.type } as unknown) as Prisma.InputJsonValue,
        },
      });

      // Keep lastActiveAt warm for orbit “recency”
      await tx.membership.update({
        where: {
          userId_communityId: {
            userId: fromUserId,
            communityId: body.communityId,
          },
        },
        data: { lastActiveAt: new Date() },
      });
    });

    // Recompute scores for both sides
    await recomputeMemberScores({ communityId: body.communityId, userId: fromUserId });
    await recomputeMemberScores({ communityId: body.communityId, userId: body.toUserId });

    return jsonOk({ ok: true, created: true });
  } catch (err) {
    const e = err as StatusError;

    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}