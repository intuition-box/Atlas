

import { HandleOwnerType, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";
import { db } from "@/lib/database";
import { requireCsrf } from "@/lib/security/csrf";
import { HandleSchema } from "@/lib/handle";

import { claimHandle } from "@/lib/handle-registry";

export const runtime = "nodejs";

type OnboardOk = {
  user: {
    id: string;
    handle: string;
    name: string | null;
    image: string | null;
    headline: string | null;
    bio: string | null;
    location: string | null;
    links: string[];
    skills: string[];
    tags: string[];
  };
};

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

function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}


const OnboardSchema = z.object({
  handle: HandleSchema,

  name: z.string().trim().min(1, "Name is required").max(80, "Name is too long").optional(),
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
    const desired = normalizeHandle(input.handle);

    // Onboarding should not overwrite an existing different handle.
    const existingOwner = await db.handleOwner.findFirst({
      where: { ownerType: HandleOwnerType.USER, ownerId: userId },
      select: { handle: { select: { name: true } } },
    });

    if (existingOwner && existingOwner.handle.name !== desired) {
      return errJson({
        code: "HANDLE_CONFLICT",
        message: "User already has a handle",
        status: 409,
        meta: { currentHandle: existingOwner.handle.name },
      });
    }

    // Claim (or re-claim) the handle using canonical policy + race-safe logic.
    const claim = await claimHandle({
      ownerType: "USER",
      ownerId: userId,
      handle: input.handle,
    });

    if (!claim.ok) {
      const status = claim.error.status ?? 409;
      return errJson({
        code: claim.error.code,
        message: claim.error.message,
        status,
        meta: {
          reclaimUntil: claim.error.reclaimUntil ?? undefined,
          availableAt: claim.error.availableAt ?? undefined,
        },
      });
    }

    const updated = await db.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.image !== undefined ? { image: input.image } : {}),
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
        image: true,
        headline: true,
        bio: true,
        location: true,
        links: true,
        skills: true,
        tags: true,
      },
    });

    // Fetch canonical handle name (source of truth).
    const owner = await db.handleOwner.findFirst({
      where: { ownerType: HandleOwnerType.USER, ownerId: updated.id },
      select: { handle: { select: { name: true } } },
    });

    const handleName = owner?.handle.name;
    if (!handleName) {
      return errJson({ code: "INTERNAL_ERROR", message: "Handle claim missing", status: 500 });
    }

    return okJson<OnboardOk>({
      user: {
        id: updated.id,
        handle: handleName,
        name: updated.name,
        image: updated.image,
        headline: updated.headline,
        bio: updated.bio,
        location: updated.location,
        links: Array.isArray(updated.links) ? (updated.links as string[]) : [],
        skills: Array.isArray(updated.skills) ? (updated.skills as string[]) : [],
        tags: Array.isArray(updated.tags) ? (updated.tags as string[]) : [],
      },
    });
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && typeof (e as any).code === "string") {
      const code = (e as any).code as string;
      const message = typeof (e as any).message === "string" ? (e as any).message : "Handle error";
      const status = typeof (e as any).status === "number" ? (e as any).status : 409;
      return errJson({
        code,
        message,
        status,
        meta: {
          reclaimUntil: (e as any).reclaimUntil ?? undefined,
          availableAt: (e as any).availableAt ?? undefined,
        },
      });
    }
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}