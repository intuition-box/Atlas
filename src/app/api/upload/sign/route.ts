// src/app/api/upload/sign/route.ts

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUser } from "@/lib/permissions";
import { signR2Upload } from "@/lib/r2";

export const runtime = "nodejs";

const Body = z.object({
  // MVP: restrict to a small set of image “buckets”
  kind: z.enum(["USER_AVATAR", "COMMUNITY_AVATAR"]),
  contentType: z.string().min(3).max(120),
  extension: z
    .string()
    .regex(/^[a-z0-9]+$/i)
    .max(8)
    .optional(),
  communityId: z.string().optional(), // required for COMMUNITY_AVATAR
});

function safeExt(contentType: string, ext?: string) {
  if (ext) return ext.toLowerCase();
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[contentType] ?? "bin";
}

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

  if (!body.contentType.startsWith("image/")) {
    return NextResponse.json(
      {
        ok: false,
        code: "UNSUPPORTED",
        error: "Only image uploads are allowed in MVP.",
      },
      { status: 400 }
    );
  }

  if (body.kind === "COMMUNITY_AVATAR" && !body.communityId) {
    return NextResponse.json(
      { ok: false, code: "INVALID", error: "communityId is required." },
      { status: 400 }
    );
  }

  const ext = safeExt(body.contentType, body.extension);
  const nonce = randomUUID();

  const key =
    body.kind === "USER_AVATAR"
      ? `avatars/users/${userId}/${nonce}.${ext}`
      : `avatars/communities/${body.communityId}/${nonce}.${ext}`;

  const { uploadUrl, publicUrl } = await signR2Upload({
    key,
    contentType: body.contentType,
  });

  return NextResponse.json({ ok: true, uploadUrl, publicUrl, key });
}