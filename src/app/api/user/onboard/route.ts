import { HandleOwnerType, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { mirrorUrlToR2 } from "@/lib/r2";
import { requireCsrf } from "@/lib/security/csrf";
import { HandleSchema } from "@/lib/handle";

import { claimHandle, resolveHandleNameForOwner } from "@/lib/handle-registry";

export const runtime = "nodejs";

type OnboardOk = {
  user: {
    id: string;
    handle: string;
    name: string | null;
    avatarUrl: string | null;
    headline: string | null;
    bio: string | null;
    location: string | null;
    links: string[];
    skills: string[];
    tags: string[];
  };
};

type TxResult =
  | { ok: true; value: OnboardOk }
  | { ok: false; error: Parameters<typeof errJson>[0] };

function uniqStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const s = v.trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

const OnboardSchema = z.object({
  handle: HandleSchema,

  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long"),

  image: z.string().url("Invalid image url").nullable().optional(),

  headline: z
    .string()
    .trim()
    .min(1, "Headline is required")
    .max(120, "Headline is too long")
    .nullable()
    .optional(),
  bio: z
    .string()
    .trim()
    .min(1, "Bio is required")
    .max(2000, "Bio is too long")
    .nullable()
    .optional(),
  location: z
    .string()
    .trim()
    .min(1, "Location is required")
    .max(120, "Location is too long")
    .nullable()
    .optional(),

  // Stored as JSON arrays on the User model. Use [] to clear.
  links: z
    .array(z.string().trim())
    .max(20, "Too many links")
    .optional()
    .transform((v) => (v === undefined ? undefined : uniqStrings(v.filter(Boolean)))),
  skills: z
    .array(z.string().trim())
    .max(50, "Too many skills")
    .optional()
    .transform((v) => (v === undefined ? undefined : uniqStrings(v.filter(Boolean)))),
  tags: z
    .array(z.string().trim())
    .max(50, "Too many tags")
    .optional()
    .transform((v) => (v === undefined ? undefined : uniqStrings(v.filter(Boolean)))),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const csrf = await requireCsrf(req);
    if (csrf instanceof Response) return csrf;

    const raw = await req.json().catch(() => null);
    const parsed = OnboardSchema.safeParse(raw);

    if (!parsed.success) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Invalid request",
        status: 400,
        issues: parsed.error.issues.map((iss) => ({
          path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
          message: iss.message,
        })),
      });
    }

    const input = parsed.data;
    const handle = input.handle; // canonical from HandleSchema

    // Mirror external avatar to R2 so we never store third-party CDN URLs.
    let avatarUrl: string | null = input.image ?? null;
    if (avatarUrl && !avatarUrl.includes(process.env.R2_PUBLIC_BASE_URL ?? "__r2__")) {
      const nonce = crypto.randomUUID();
      const r2Url = await mirrorUrlToR2({
        url: avatarUrl,
        key: `avatars/users/${userId}/${nonce}.png`,
      });
      if (r2Url) avatarUrl = r2Url;
    }

    const txResult: TxResult = await db.$transaction(async (tx) => {
      // Onboarding should not overwrite an existing different handle.
      const existingHandle = await resolveHandleNameForOwner(
        { ownerType: HandleOwnerType.USER, ownerId: userId },
        tx,
      );

      if (existingHandle && existingHandle !== handle) {
        return {
          ok: false,
          error: {
            code: "HANDLE_CONFLICT",
            message: "User already has a handle",
            status: 409,
            meta: { currentHandle: existingHandle },
          },
        };
      }

      // Claim (or re-claim) the handle using canonical policy + race-safe logic.
      const claim = await claimHandle(tx, {
        ownerType: HandleOwnerType.USER,
        ownerId: userId,
        handle,
      });

      if (!claim.ok) {
        return { ok: false, error: claim.error };
      }

      const handleName = claim.value.handle;

      const current = await tx.user.findUnique({
        where: { id: userId },
        select: { onboardedAt: true },
      });

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          onboarded: true,
          onboardedAt: current?.onboardedAt ?? new Date(),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
          ...(input.headline !== undefined ? { headline: input.headline } : {}),
          ...(input.bio !== undefined ? { bio: input.bio } : {}),
          ...(input.location !== undefined ? { location: input.location } : {}),
          ...(input.links !== undefined ? { links: input.links } : {}),
          ...(input.skills !== undefined ? { skills: input.skills } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        },
        select: {
          id: true,
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

      return {
        ok: true,
        value: {
          user: {
            id: updated.id,
            handle: handleName,
            name: updated.name,
            avatarUrl: updated.avatarUrl,
            headline: updated.headline,
            bio: updated.bio,
            location: updated.location,
            links: Array.isArray(updated.links) ? (updated.links as string[]) : [],
            skills: Array.isArray(updated.skills) ? (updated.skills as string[]) : [],
            tags: Array.isArray(updated.tags) ? (updated.tags as string[]) : [],
          },
        },
      };
    });

    if (!txResult.ok) return errJson(txResult.error);
    return okJson<OnboardOk>(txResult.value);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}