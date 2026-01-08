import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/database";
import { requireCommunityRole, requireUser } from "@/lib/permissions";

export const runtime = "nodejs";

const Body = z.object({
  communityId: z.string().min(1),
  userId: z.string().min(1),
  action: z.enum(["BAN", "UNBAN"]),
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

  // Safety: do not allow banning the OWNER membership.
  if (body.action === "BAN") {
    const target = await db.membership.findUnique({
      where: {
        userId_communityId: { userId: body.userId, communityId: body.communityId },
      },
      select: { role: true },
    });

    if (target?.role === "OWNER") {
      return NextResponse.json(
        { ok: false, code: "FORBIDDEN", error: "You can't ban the owner." },
        { status: 403 }
      );
    }
  }

  const nextStatus = body.action === "BAN" ? "BANNED" : "APPROVED";

  await db.$transaction(async (tx) => {
    await tx.membership.update({
      where: {
        userId_communityId: { userId: body.userId, communityId: body.communityId },
      },
      data: { status: nextStatus },
    });

    await tx.activityEvent.create({
      data: {
        communityId: body.communityId,
        actorId,
        subjectUserId: body.userId,
        type: body.action === "BAN" ? "BANNED" : "UNBANNED",
      },
    });
  });

  return NextResponse.json({ ok: true, updated: true });
}