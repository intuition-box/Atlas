import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/database";
import { requireCommunityRole, requireUser } from "@/lib/permissions";

export const runtime = "nodejs";

type ApiError = {
  code: number;
  message: string;
  details?: unknown;
};

function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

function jsonFail(status: number, message: string, details?: unknown, init?: ResponseInit) {
  const error: ApiError = { code: status, message, ...(details !== undefined ? { details } : {}) };
  return NextResponse.json({ ok: false, error }, { status, ...init });
}

const Body = z.object({
  communityId: z.string().min(1),
  memberUserId: z.string().min(1),
  action: z.enum(["BAN", "UNBAN"]),
});

export async function POST(req: Request) {
  const { userId: actorId } = await requireUser();

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return jsonFail(400, "Invalid JSON body");
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return jsonFail(400, "Invalid request", parsed.error.flatten());
  }

  const body = parsed.data;

  await requireCommunityRole({
    userId: actorId,
    communityId: body.communityId,
    minRole: "ADMIN",
  });

  const target = await db.membership.findUnique({
    where: {
      userId_communityId: {
        userId: body.memberUserId,
        communityId: body.communityId,
      },
    },
    select: { role: true },
  });

  if (!target) {
    return jsonFail(404, "Membership not found");
  }

  // Safety: do not allow banning the OWNER membership.
  if (body.action === "BAN" && target.role === "OWNER") {
    return jsonFail(403, "You can't ban the owner.");
  }

  const nextStatus = body.action === "BAN" ? "BANNED" : "APPROVED";
  const eventType = body.action === "BAN" ? "BANNED" : "UNBANNED";

  await db.$transaction(async (tx) => {
    await tx.membership.update({
      where: {
        userId_communityId: {
          userId: body.memberUserId,
          communityId: body.communityId,
        },
      },
      data: { status: nextStatus },
      select: { userId: true },
    });

    await tx.activityEvent.create({
      data: {
        communityId: body.communityId,
        actorId,
        subjectUserId: body.memberUserId,
        type: eventType,
      },
      select: { id: true },
    });
  });

  return jsonOk({ updated: true });
}