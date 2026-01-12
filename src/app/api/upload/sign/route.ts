import "server-only";

import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import { requireAuth } from "@/lib/guards";
import { signR2Upload } from "@/lib/r2";
import { requireCsrf } from "@/lib/security/csrf";
import { MembershipRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const UploadTypeSchema = z.enum(["user.avatar", "community.avatar"]);

// Keep this strict and explicit.
// Add new types only when the product pipeline supports them end-to-end.
const ContentTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);

type ContentType = z.infer<typeof ContentTypeSchema>;

const EXT_BY_CONTENT_TYPE: Record<ContentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const SignUploadSchema = z
  .object({
    type: UploadTypeSchema,
    contentType: ContentTypeSchema,

    // Used for client-side UX + future guards. R2 signing itself is based on key + contentType.
    size: z.number().int().positive().max(25 * 1024 * 1024),

    // Required for community assets.
    communityId: z.string().trim().min(1).optional(),
  })
  .refine((v) => (v.type === "community.avatar" ? Boolean(v.communityId) : true), {
    message: "communityId is required for community.avatar",
    path: ["communityId"],
  });

function zodIssuesToApiIssues(
  e: z.ZodError,
): Array<{ path: Array<string | number>; message: string }> {
  return e.issues.map((iss) => ({
    path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
    message: iss.message,
  }));
}

export async function POST(req: NextRequest) {
  try {
    requireCsrf(req);
    const { userId } = await requireAuth();

    const json = await req.json().catch(() => null);
    const parsed = await SignUploadSchema.safeParseAsync(json);
    if (!parsed.success) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Invalid request",
        status: 400,
        issues: zodIssuesToApiIssues(parsed.error),
      });
    }

    const input = parsed.data;
    const ext = EXT_BY_CONTENT_TYPE[input.contentType];

    // Authorization for community assets.
    let communityId: string | null = null;

    if (input.type === "community.avatar") {
      // `refine` guarantees this at runtime; keep TS happy.
      communityId = input.communityId ?? null;
      if (!communityId) {
        return errJson({
          code: "INVALID_REQUEST",
          message: "communityId is required for community.avatar",
          status: 400,
        });
      }

      const membership = await db.membership.findUnique({
        where: {
          userId_communityId: {
            userId,
            communityId,
          },
        },
        select: { role: true },
      });

      const canUpload =
        membership &&
        (membership.role === MembershipRole.OWNER ||
          membership.role === MembershipRole.ADMIN);

      if (!canUpload) {
        return errJson({ code: "FORBIDDEN", message: "Forbidden", status: 403 });
      }
    }

    // Server chooses the object key. Never accept a raw key from clients.
    // Keep keys clear and scoped by owner id.
    const nonce = randomUUID();

    const key =
      input.type === "user.avatar"
        ? `avatars/users/${userId}/${nonce}.${ext}`
        : `avatars/communities/${communityId}/${nonce}.${ext}`;

    const upload = await signR2Upload({
      key,
      contentType: input.contentType,
      // Avatars are versioned by key, so immutable caching is safe.
      cacheControl: "public, max-age=31536000, immutable",
      expiresInSeconds: 60,
    });

    return okJson({
      upload: {
        key,
        uploadUrl: upload.uploadUrl,
        publicUrl: upload.publicUrl,
      },
    });
  } catch (e) {
    if (e instanceof Error) {
      return errJson({ code: "INTERNAL_ERROR", message: e.message, status: 500 });
    }
    return errJson({ code: "INTERNAL_ERROR", message: "Internal error", status: 500 });
  }
}