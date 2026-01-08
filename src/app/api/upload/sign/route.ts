import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCommunityRole, requireUser } from "@/lib/permissions";
import { signR2Upload } from "@/lib/r2";

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

const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

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

function extFromContentType(contentType: string): string {
  switch (contentType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

function safeExt(contentType: string, ext?: string) {
  // If caller supplies an extension, accept it only if it matches the inferred one.
  // This prevents content-type/extension drift (e.g. image/png + .jpg).
  const inferred = extFromContentType(contentType);
  if (!ext) return inferred;
  const provided = ext.toLowerCase();
  if (provided !== inferred) return inferred;
  return provided;
}

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

  if (!ALLOWED_IMAGE_TYPES.has(body.contentType)) {
    return jsonFail(400, "Only PNG/JPEG/WebP/GIF image uploads are allowed in MVP.");
  }

  if (body.kind === "COMMUNITY_AVATAR") {
    if (!body.communityId) {
      return jsonFail(400, "communityId is required.");
    }

    // Only community admins/owners can upload a community avatar.
    await requireCommunityRole({
      userId,
      communityId: body.communityId,
      minRole: "ADMIN",
    });
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

  return jsonOk({ uploadUrl, publicUrl, key });
}