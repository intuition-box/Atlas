import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/permissions";
import { ProfileUpdateSchema } from "@/lib/validation/profile";

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

  const parsed = ProfileUpdateSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const user = await db.user.update({
    where: { id: userId },
    data: {
      ...(body.headline !== undefined ? { headline: body.headline } : {}),
      ...(body.bio !== undefined ? { bio: body.bio } : {}),
      ...(body.location !== undefined ? { location: body.location } : {}),
      ...(body.links !== undefined
        ? { links: body.links.filter(Boolean) as string[] }
        : {}),
      ...(body.skills !== undefined ? { skills: body.skills } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.avatarUrl !== undefined ? { avatarUrl: body.avatarUrl } : {}),
    },
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
    },
  });

  return NextResponse.json({ ok: true, user });
}