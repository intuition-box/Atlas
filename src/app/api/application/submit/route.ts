import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";

import { db } from "@/lib/database";
import { requireUser } from "@/lib/permissions";
import { ApplicationSubmitSchema } from "@/lib/validation/application";
import { recomputeMemberScores } from "@/lib/scoring";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { userId } = await requireUser();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = ApplicationSubmitSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const existing = await db.membership.findUnique({
    where: { userId_communityId: { userId, communityId: body.communityId } },
    select: { status: true },
  });

  if (existing?.status === "APPROVED") {
    return NextResponse.json(
      {
        ok: false,
        code: "ALREADY_APPROVED",
        error: "You are already approved in this community.",
      },
      { status: 409 }
    );
  }

  if (existing?.status === "BANNED") {
    return NextResponse.json(
      { ok: false, code: "BANNED", error: "You are banned from this community." },
      { status: 403 }
    );
  }

  await db.$transaction(async (tx) => {
    // Ensure membership exists
    await tx.membership.upsert({
      where: { userId_communityId: { userId, communityId: body.communityId } },
      create: {
        userId,
        communityId: body.communityId,
        status: "PENDING",
        role: "MEMBER",
        orbitLevel: "EXPLORER",
        lastActiveAt: new Date(),
      },
      update: { status: "PENDING", lastActiveAt: new Date() },
    });

    // Single active application per user/community (unique index)
    await tx.application.upsert({
      where: { userId_communityId: { userId, communityId: body.communityId } },
      create: {
        userId,
        communityId: body.communityId,
        status: "SUBMITTED",
        answers: body.answers as Prisma.InputJsonValue,
      },
      update: {
        status: "SUBMITTED",
        answers: body.answers as Prisma.InputJsonValue,
        reviewerId: null,
        reviewedAt: null,
      },
    });

    await tx.activityEvent.create({
      data: { communityId: body.communityId, actorId: userId, type: "APPLIED" },
    });
  });

  await recomputeMemberScores({ communityId: body.communityId, userId });

  return NextResponse.json({ ok: true, submitted: true });
}