import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/database";
import { requireApprovedMember, requireUser } from "@/lib/permissions";
import { recomputeMemberScores } from "@/lib/scoring";
import { AttestationCreateSchema } from "@/lib/validation/attestation";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId: fromUserId } = await requireUser();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = AttestationCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  if (body.toUserId === fromUserId) {
    return NextResponse.json(
      { ok: false, code: "INVALID", error: "You can't attest to yourself." },
      { status: 400 }
    );
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
    return NextResponse.json(
      {
        ok: false,
        code: "DUPLICATE",
        error: "You already created this attestation recently.",
      },
      { status: 409 }
    );
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

    // keep lastActiveAt warm for orbit “recency”
    await tx.membership.update({
      where: {
        userId_communityId: { userId: fromUserId, communityId: body.communityId },
      },
      data: { lastActiveAt: new Date() },
    });
  });

  // Recompute scores for both sides
  await recomputeMemberScores({ communityId: body.communityId, userId: fromUserId });
  await recomputeMemberScores({ communityId: body.communityId, userId: body.toUserId });

  return NextResponse.json({ ok: true, created: true });
}