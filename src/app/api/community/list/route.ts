import { NextResponse } from "next/server";

import { db } from "@/lib/database";
import { CommunityListSchema } from "@/lib/validation/community";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const raw = {
    take: sp.get("take") ? Number(sp.get("take")) : undefined,
    includePrivate: sp.get("includePrivate") === "true" ? true : undefined,
  };

  const parsed = CommunityListSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const communities = await db.community.findMany({
    take: body.take ?? 24,
    orderBy: { createdAt: "desc" },
    where: body.includePrivate ? undefined : { isPublicDirectory: true },
    select: {
      id: true,
      handle: true,
      name: true,
      description: true,
      avatarUrl: true,
      isPublicDirectory: true,
      _count: { select: { memberships: true } },
    },
  });

  return NextResponse.json({ ok: true, communities });
}