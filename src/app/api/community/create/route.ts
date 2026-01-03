import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { CommunityCreateSchema } from "@/lib/validation/community";

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

  const parsed = CommunityCreateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const community = await db.$transaction(async (tx) => {
    const created = await tx.community.create({
      data: {
        name: body.name,
        handle: body.handle,
        description: body.description ?? null,
        avatarUrl: body.avatarUrl ?? null,
        isPublicDirectory: body.isPublicDirectory ?? false,
        ownerId: userId,
        memberships: {
          create: {
            userId,
            role: "OWNER",
            status: "APPROVED",
            approvedAt: new Date(),
            orbitLevel: "ADVOCATE",
            loveScore: 5,
            reachScore: 1,
            gravityScore: 5,
            lastActiveAt: new Date(),
          },
        },
        activityEvents: {
          create: { actorId: userId, type: "COMMUNITY_CREATED" },
        },
      },
      select: { id: true, handle: true, name: true },
    });

    return created;
  });

  return NextResponse.json({ ok: true, community });
}