import { Prisma } from "@prisma/client";
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
  // MVP: owner can promote/demote. Do not allow setting OWNER via API.
  role: z.enum(["ADMIN", "MODERATOR", "MEMBER"]),
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
    minRole: "OWNER",
  });

  const exists = await db.membership.findUnique({
    where: {
      userId_communityId: {
        userId: body.memberUserId,
        communityId: body.communityId,
      },
    },
    select: { userId: true },
  });

  if (!exists) {
    return jsonFail(404, "Membership not found");
  }

  await db.$transaction(async (tx) => {
    await tx.membership.update({
      where: {
        userId_communityId: {
          userId: body.memberUserId,
          communityId: body.communityId,
        },
      },
      data: { role: body.role },
      select: { userId: true },
    });

    await tx.activityEvent.create({
      data: {
        communityId: body.communityId,
        actorId,
        subjectUserId: body.memberUserId,
        type: "ROLE_UPDATED",
        metadata: { role: body.role } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  });

  return jsonOk({ updated: true });
}