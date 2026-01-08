import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/database";
import { requireCommunityRole, requireUser } from "@/lib/permissions";
import { recomputeOrbitLevelsForCommunity } from "@/lib/scoring";

export const runtime = "nodejs";

const Body = z.object({
  communityId: z.string().min(1),
  userId: z.string().min(1),
  orbitLevelOverride: z
    .enum(["EXPLORER", "PARTICIPANT", "CONTRIBUTOR", "ADVOCATE"])
    .nullable(),
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

  const body = parsed.data;

  await requireCommunityRole({
    userId: actorId,
    communityId: body.communityId,
    minRole: "ADMIN",
  });

  await db.$transaction(async (tx) => {
    await tx.membership.update({
      where: {
        userId_communityId: { userId: body.userId, communityId: body.communityId },
      },
      data: { orbitLevelOverride: body.orbitLevelOverride },
    });

    await tx.activityEvent.create({
      data: {
        communityId: body.communityId,
        actorId,
        subjectUserId: body.userId,
        type: "ORBIT_OVERRIDE",
        metadata: ({ orbitLevelOverride: body.orbitLevelOverride } as unknown) as Prisma.InputJsonValue,
      },
    });
  });

  // Recompute levels so orbitLevel reflects overrides + computed buckets
  await recomputeOrbitLevelsForCommunity({ communityId: body.communityId });

  return NextResponse.json({ ok: true, updated: true });
}