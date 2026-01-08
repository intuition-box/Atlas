import { NextResponse } from "next/server";

import { db } from "@/lib/database";
import { UserGetQuerySchema } from "@/lib/validation/user";

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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const sp = url.searchParams;

  const raw = {
    userId: sp.get("userId") || undefined,
    handle: sp.get("handle") || undefined,
  };

  const parsed = UserGetQuerySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonFail(400, "Invalid request", parsed.error.flatten());
  }

  const body = parsed.data;

  // Prefer id when provided.
  const where = body.userId ? { id: body.userId } : { handle: body.handle! };

  const user = await db.user.findUnique({
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

  if (!user) {
    return jsonFail(404, "User not found");
  }

  return jsonOk({ user });
}