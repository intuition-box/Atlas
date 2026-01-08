import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/database";
import { HandleSchema } from "@/lib/handle";
import { makeHandle } from "@/lib/handle-registry";
import { requireUser } from "@/lib/permissions";

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
  name: z.string().trim().min(1).max(80),
  handle: HandleSchema,
  avatarUrl: z.string().url().optional().or(z.literal("")),
  headline: z.string().trim().max(120).optional().or(z.literal("")),
  bio: z.string().trim().max(2000).optional().or(z.literal("")),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  links: z.array(z.string().url()).max(10).optional(),
  skills: z.array(z.string().trim().min(1).max(40)).max(24).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(24).optional(),
});

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

  const body = parsed.data;

  let handle: string;
  try {
    // 1) Claim the handle (writes Handle ledger + canonical User.handle)
    handle = await makeHandle({
      ownerType: "USER",
      ownerId: userId,
      desired: body.handle,
    });
  } catch (e: any) {
    return jsonFail(409, e?.message ?? "Handle not available");
  }

  try {
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
  } catch {
    return jsonFail(500, "Failed to onboard");
  }

  return jsonOk({ handle });
}