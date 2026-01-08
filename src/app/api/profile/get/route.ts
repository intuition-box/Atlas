import { NextResponse } from "next/server";

import { db } from "@/lib/database";
import { ProfileGetSchema } from "@/lib/validation/profile";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const raw = {
    userId: sp.get("userId") || undefined,
    handle: sp.get("handle") || undefined,
  };

  const parsed = ProfileGetSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const where = body.userId ? { id: body.userId } : { handle: body.handle! };

  const user = await db.user.findFirst({
    where,
    select: {
      id: true,
      handle: true,
      name: true,
      avatarUrl: true,
      headline: true,
      bio: true,
      location: true,
      links: true,
      skills: true,
      tags: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, user });
}