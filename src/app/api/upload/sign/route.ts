import "server-only";

import { errJson, okJson } from "@/lib/api/server";
import { requireAuth } from "@/lib/auth/policy";
import { db } from "@/lib/db/client";
import { putR2Object, signR2Upload } from "@/lib/r2";
import { requireCsrf } from "@/lib/security/csrf";
import { MembershipRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const UploadTypeSchema = z.enum(["user.avatar", "community.avatar"]);

function normalizeUploadType(value: unknown): unknown {
  if (value === "avatar") return "user.avatar";
  if (value === "communityAvatar") return "community.avatar";
  return value;
}

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

// Unique object name component for uploads.
// We keep it opaque and collision-resistant.
function makeUploadNonce(): string {
  return randomUUID();
}

const SignUploadSchema = z
  .object({
    type: z.preprocess(normalizeUploadType, UploadTypeSchema),
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
    const contentTypeHeader = req.headers.get("content-type") ?? "";

    // If the browser can’t PUT to R2 (CORS/preflight), we also support proxy uploads:
    // POST multipart/form-data to this same endpoint with a `file` field.
    if (contentTypeHeader.includes("multipart/form-data")) {
      requireCsrf(req);
      const { userId } = await requireAuth();
      const form = await req.formData();
      const file = form.get("file");

      if (!(file instanceof File)) {
        return errJson({
          code: "INVALID_REQUEST",
          message: "Missing file",
          status: 400,
          issues: [{ path: ["file"], message: "File is required" }],
        });
      }

      const typeRaw = form.get("type");
      const communityIdRaw = form.get("communityId");

      const jsonLike = {
        type: typeof typeRaw === "string" && typeRaw.length > 0 ? typeRaw : "avatar",
        contentType: file.type,
        size: file.size,
        communityId:
          typeof communityIdRaw === "string" && communityIdRaw.trim().length > 0
            ? communityIdRaw.trim()
            : undefined,
      };

      const parsed = await SignUploadSchema.safeParseAsync(jsonLike);
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
      const nonce = makeUploadNonce();

      const key =
        input.type === "user.avatar"
          ? `avatars/users/${userId}/${nonce}.${ext}`
          : `avatars/communities/${communityId}/${nonce}.${ext}`;

      const body = Buffer.from(await file.arrayBuffer());

      const uploaded = await putR2Object({
        key,
        body,
        contentType: input.contentType,
        cacheControl: "public, max-age=31536000, immutable",
      });

      const publicUrl = uploaded.publicUrl;
      if (!publicUrl) {
        return errJson({
          code: "INTERNAL_ERROR",
          message: "Upload succeeded but no publicUrl was returned",
          status: 500,
        });
      }

      return okJson({
        publicUrl,
        upload: {
          key,
          publicUrl,
        },
      });
    }

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
    const nonce = makeUploadNonce();

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

    const publicUrl = upload.publicUrl;
    if (!publicUrl) {
      return errJson({
        code: "INTERNAL_ERROR",
        message: "Signing succeeded but no publicUrl was returned",
        status: 500,
      });
    }

    return okJson({
      publicUrl,
      upload: {
        key,
        uploadUrl: upload.uploadUrl,
        publicUrl,
      },
    });
  } catch (e) {
    if (e instanceof Error) {
      return errJson({ code: "INTERNAL_ERROR", message: e.message, status: 500 });
    }
    return errJson({ code: "INTERNAL_ERROR", message: "Internal error", status: 500 });
  }
}