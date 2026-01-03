// src/app/api/member/updateRole/route.ts

import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireCommunityRole, requireUser } from "@/lib/permissions";

export const runtime = "nodejs";

const Body = z.object({
  communityId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]), // MVP: owner promotes/demotes admin
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
    minRole: "OWNER",
  });

  await db.$transaction(async (tx) => {
    await tx.membership.update({
      where: {
        userId_communityId: { userId: body.userId, communityId: body.communityId },
      },
      data: { role: body.role },
    });

    await tx.activityEvent.create({
      data: {
        communityId: body.communityId,
        actorId,
        subjectUserId: body.userId,
        type: "ROLE_UPDATED",
        metadata: ({ role: body.role } as unknown) as Prisma.InputJsonValue,
      },
    });
  });

  return NextResponse.json({ ok: true, updated: true });
}