import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/database";
import { requireUser } from "@/lib/permissions";

export const runtime = "nodejs";

const Body = z.object({ communityId: z.string().min(1) });

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

export async function POST(req: Request) {
  const { userId } = await requireUser();

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

  const { communityId } = parsed.data;

  // If membership exists and user is banned, block join.
  const existing = await db.membership.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { status: true },
  });

  if (existing?.status === "BANNED") {
    return jsonFail(403, "You are banned from this community.");
  }

  // Create membership if missing; keep as PENDING until application review.
  // If already a member (pending/approved/etc), we just refresh lastActiveAt.
  const now = new Date();

  if (!existing) {
    const membership = await db.membership.create({
      data: {
        userId,
        communityId,
        status: "PENDING",
        role: "MEMBER",
        orbitLevel: "EXPLORER",
        lastActiveAt: now,
      },
      select: { communityId: true, status: true, role: true, orbitLevel: true },
    });

    await db.activityEvent.create({
      data: { communityId, actorId: userId, type: "JOINED" },
    });

    return jsonOk({ membership });
  }

  const membership = await db.membership.update({
    where: { userId_communityId: { userId, communityId } },
    data: { lastActiveAt: now },
    select: { communityId: true, status: true, role: true, orbitLevel: true },
  });

  return jsonOk({ membership });
}