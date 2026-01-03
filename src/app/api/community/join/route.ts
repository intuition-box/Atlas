import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/permissions";

export const runtime = "nodejs";

const Body = z.object({ communityId: z.string().min(1) });

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

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { communityId } = parsed.data;

  // If membership exists and user is banned, block join.
  const existing = await db.membership.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { status: true, role: true },
  });

  if (existing?.status === "BANNED") {
    return NextResponse.json(
      { ok: false, code: "BANNED", error: "You are banned from this community." },
      { status: 403 }
    );
  }

  // Create membership if missing; keep as PENDING until application review.
  const membership = await db.membership.upsert({
    where: { userId_communityId: { userId, communityId } },
    create: {
      userId,
      communityId,
      status: "PENDING",
      role: "MEMBER",
      orbitLevel: "EXPLORER",
      lastActiveAt: new Date(),
    },
    update: { lastActiveAt: new Date() },
    select: { status: true, role: true, communityId: true },
  });

  await db.activityEvent.create({
    data: { communityId, actorId: userId, type: "JOINED" },
  });

  return NextResponse.json({ ok: true, membership });
}