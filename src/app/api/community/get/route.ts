import { NextResponse } from "next/server";

import { db } from "@/lib/database";
import { CommunityGetSchema } from "@/lib/validation/community";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const raw = {
    communityId: sp.get("communityId") || undefined,
    handle: sp.get("handle") || undefined,
  };

  const parsed = CommunityGetSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const where = body.communityId
    ? { id: body.communityId }
    : { handle: body.handle! };

  const community = await db.community.findFirst({
    where,
    select: {
      id: true,
      handle: true,
      name: true,
      description: true,
      avatarUrl: true,
      ownerId: true,
      isPublicDirectory: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, community });
}