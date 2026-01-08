import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/database";
import { requireCommunityRole, requireUser } from "@/lib/permissions";
import { recomputeMemberScores } from "@/lib/scoring";

export const runtime = "nodejs";

const Body = z.object({
  communityId: z.string().min(1),
  userId: z.string().min(1), // applicant userId
  action: z.enum(["APPROVE", "REJECT"]),
});

export async function POST(req: Request) {
  const { userId: actorId } = await requireUser();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { communityId, userId: applicantId, action } = parsed.data;

  await requireCommunityRole({
    userId: actorId,
    communityId,
    minRole: "ADMIN",
  });

  const status = action === "APPROVE" ? "APPROVED" : "REJECTED";

  await db.$transaction(async (tx) => {
    // Will throw if missing; that's fine (500 -> indicates bad state)
    await tx.application.update({
      where: { userId_communityId: { userId: applicantId, communityId } },
      data: { status, reviewerId: actorId, reviewedAt: new Date() },
    });

    await tx.membership.update({
      where: { userId_communityId: { userId: applicantId, communityId } },
      data: {
        status,
        approvedAt: action === "APPROVE" ? new Date() : null,
      },
    });

    await tx.activityEvent.create({
      data: {
        communityId,
        actorId,
        subjectUserId: applicantId,
        type: action === "APPROVE" ? "APPROVED" : "REJECTED",
      },
    });
  });

  // Lightweight recompute (kept outside the tx)
  await recomputeMemberScores({ communityId, userId: applicantId });

  return NextResponse.json({ ok: true });
}