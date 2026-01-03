import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { requireUser } from "@/lib/permissions";

export const runtime = "nodejs";

const Body = z.object({
  name: z.string().min(1).max(80),
  handle: z
    .string()
    .min(3)
    .max(32)
    .regex(/^[a-z0-9][a-z0-9_]{1,30}[a-z0-9]$/i, "Invalid handle"),
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
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = Body.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const body = parsed.data;
  const now = new Date();

  try {
    const user = await db.$transaction(async (tx) => {
      // 1) Check if handle is already taken by ACTIVE handle record
      const existing = await tx.handle.findFirst({
        where: { value: body.handle.toLowerCase(), state: "ACTIVE" },
        select: { id: true },
      });

      if (existing) {
        throw new Error("Handle is already taken.");
      }

      // 2) Create ACTIVE handle record for this user
      await tx.handle.create({
        data: {
          value: body.handle.toLowerCase(),
          subjectType: "USER",
          subjectId: userId,
          state: "ACTIVE",
          activatedAt: now,
        },
      });

      // 3) Update user profile + mark onboarded
      return tx.user.update({
        where: { id: userId },
        data: {
          name: body.name,
          handle: body.handle.toLowerCase(),
          avatarUrl: body.avatarUrl || null,
          headline: body.headline || null,
          bio: body.bio || null,
          location: body.location || null,
          links: body.links ?? [],
          skills: body.skills ?? [],
          tags: body.tags ?? [],
          onboardedAt: now,
        },
        select: { id: true, handle: true, onboardedAt: true },
      });
    });

    return NextResponse.json({ ok: true, user });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Failed to onboard" },
      { status: 400 }
    );
  }
}