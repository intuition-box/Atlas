import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { makeHandle } from "@/lib/handle";
import { requireUser } from "@/lib/permissions";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(80),
  handle: z.string().min(3).max(64),
  avatarUrl: z.string().url().optional().or(z.literal("")),
  headline: z.string().max(120).optional().or(z.literal("")),
  bio: z.string().max(2000).optional().or(z.literal("")),
  location: z.string().max(120).optional().or(z.literal("")),
  links: z.array(z.string().url()).max(10).optional(),
  skills: z.array(z.string().min(1).max(40)).max(24).optional(),
  tags: z.array(z.string().min(1).max(32)).max(24).optional(),
});

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

  const body = parsed.data;

  try {
    // 1) Claim the handle (transactional: ledger + canonical User.handle)
    const handle = await makeHandle({
      ownerType: "USER",
      ownerId: userId,
      desired: body.handle,
    });

    // 2) Update the rest of the profile fields
    await db.user.update({
      where: { id: userId },
      data: {
        name: body.name,
        avatarUrl: body.avatarUrl ? body.avatarUrl : null,
        headline: body.headline ? body.headline : null,
        bio: body.bio ? body.bio : null,
        location: body.location ? body.location : null,
        links: body.links ?? [],
        skills: body.skills ?? [],
        tags: body.tags ?? [],
      },
      select: { id: true },
    });

    return NextResponse.json({ ok: true, handle });
  } catch (e: any) {
    const message = e?.message ?? "Failed to onboard";
    const status = /taken|reserved|available|cooling/i.test(message) ? 409 : 400;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}