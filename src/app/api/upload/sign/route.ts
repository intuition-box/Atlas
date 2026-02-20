import "server-only";

import { errJson, okJson } from "@/lib/api/server";
import { requireAuth } from "@/lib/auth/policy";
import { db } from "@/lib/db/client";
import { deleteR2Prefix, putR2Object, signR2Upload } from "@/lib/r2";
import { requireCsrf } from "@/lib/security/csrf";
import { buildRateLimitHeaders, getRateLimitKey, rateLimit } from "@/lib/security/rate-limit";
import { MembershipRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 1 * 1024 * 1024; // 1 MB

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
    size: z.number().int().positive().max(MAX_AVATAR_BYTES),

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

/**
 * Resolve the R2 prefix for avatar cleanup and the DB write for persisting the avatar URL.
 *
 * For user avatars: deletes all objects under `avatars/users/{userId}/`, writes `user.avatarUrl`.
 * For community avatars: deletes all objects under `avatars/communities/{communityId}/`, writes `community.avatarUrl`.
 *
 * Returns the owner-scoped prefix for R2 cleanup.
 */
async function cleanupAndPersistAvatar(
  type: "user.avatar" | "community.avatar",
  ownerId: string,
  publicUrl: string,
): Promise<void> {
  if (type === "user.avatar") {
    // Nuke all existing avatars for this user, then save the new URL.
    await deleteR2Prefix(`avatars/users/${ownerId}/`);
    await db.user.update({
      where: { id: ownerId },
      data: { avatarUrl: publicUrl, image: publicUrl },
      select: { id: true },
    });
  } else {
    await deleteR2Prefix(`avatars/communities/${ownerId}/`);
    await db.community.update({
      where: { id: ownerId },
      data: { avatarUrl: publicUrl },
      select: { id: true },
    });
  }
}

/**
 * Authorize a community avatar upload.
 * Returns the communityId if authorized, or an error response.
 */
async function authorizeCommunityUpload(
  userId: string,
  communityId: string | undefined,
): Promise<{ communityId: string } | { error: ReturnType<typeof errJson> }> {
  if (!communityId) {
    return {
      error: errJson({
        code: "INVALID_REQUEST",
        message: "communityId is required for community.avatar",
        status: 400,
      }),
    };
  }

  const membership = await db.membership.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { role: true },
  });

  const canUpload =
    membership &&
    (membership.role === MembershipRole.OWNER ||
      membership.role === MembershipRole.ADMIN);

  if (!canUpload) {
    return { error: errJson({ code: "FORBIDDEN", message: "Forbidden", status: 403 }) };
  }

  return { communityId };
}

export async function POST(req: NextRequest) {
  try {
    // ── Rate limit (before auth to prevent DoS on auth lookups) ──
    const rlKey = getRateLimitKey(req);
    const rl = await rateLimit({ key: rlKey, policyId: "upload" });

    if (!rl.allowed) {
      return errJson(
        { code: "RATE_LIMITED", message: "Too many uploads. Please slow down.", status: 429 },
        { headers: buildRateLimitHeaders(rl) },
      );
    }

    const contentTypeHeader = req.headers.get("content-type") ?? "";

    // ── Multipart proxy path ──
    // If the browser can't PUT to R2 (CORS/preflight), we also support proxy uploads:
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
        const authResult = await authorizeCommunityUpload(userId, input.communityId);
        if ("error" in authResult) return authResult.error;
        communityId = authResult.communityId;
      }

      // Server chooses the object key. Never accept a raw key from clients.
      const ownerId = input.type === "user.avatar" ? userId : communityId!;
      const nonce = makeUploadNonce();
      const key =
        input.type === "user.avatar"
          ? `avatars/users/${ownerId}/${nonce}.${ext}`
          : `avatars/communities/${ownerId}/${nonce}.${ext}`;

      // Delete all old avatars in the owner's R2 folder BEFORE uploading the new one.
      const prefix =
        input.type === "user.avatar"
          ? `avatars/users/${ownerId}/`
          : `avatars/communities/${ownerId}/`;
      await deleteR2Prefix(prefix);

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

      // Persist to DB immediately so the avatar survives page refreshes without saving.
      // NOTE: We already deleted old avatars via deleteR2Prefix above, so we only need
      // the DB write here — NOT another prefix cleanup (which would delete the file we just uploaded).
      if (input.type === "user.avatar") {
        await db.user.update({
          where: { id: ownerId },
          data: { avatarUrl: publicUrl, image: publicUrl },
          select: { id: true },
        });
      } else {
        await db.community.update({
          where: { id: ownerId },
          data: { avatarUrl: publicUrl },
          select: { id: true },
        });
      }

      return okJson({ publicUrl, upload: { key, publicUrl } });
    }

    // ── Presign path (legacy) ──
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
      const authResult = await authorizeCommunityUpload(userId, input.communityId);
      if ("error" in authResult) return authResult.error;
      communityId = authResult.communityId;
    }

    // Server chooses the object key. Never accept a raw key from clients.
    const ownerId = input.type === "user.avatar" ? userId : communityId!;
    const nonce = makeUploadNonce();
    const key =
      input.type === "user.avatar"
        ? `avatars/users/${ownerId}/${nonce}.${ext}`
        : `avatars/communities/${ownerId}/${nonce}.${ext}`;

    // Delete old avatars before generating presigned URL.
    const prefix =
      input.type === "user.avatar"
        ? `avatars/users/${ownerId}/`
        : `avatars/communities/${ownerId}/`;
    await deleteR2Prefix(prefix);

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
