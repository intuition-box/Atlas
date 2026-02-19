import { HandleOwnerType, Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { HandleSchema } from "@/lib/handle";
import { claimHandle, resolveHandleNameForOwner } from "@/lib/handle-registry";
import type { HandleProblem } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type UpdateUserOk = {
  user: {
    id: string;
    handle: string | null;
    name: string | null;
    image: string | null;
    headline: string | null;
    bio: string | null;
    location: string | null;
    links: string[];
    skills: string[];
    tags: string[];
    languages: string[];
    contactPreference: string | null;
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

const UpdateUserSchema = z
  .object({
    handle: HandleSchema.optional(),
    name: z.string().trim().min(1, "Name is required").max(80, "Name is too long").optional(),
    image: z.string().url("Invalid image url").nullable().optional(),
    headline: z.string().trim().min(1, "Headline is required").max(120, "Headline is too long").nullable().optional(),
    bio: z.string().trim().min(1, "Bio is required").max(2000, "Bio is too long").nullable().optional(),
    location: z.string().trim().min(1, "Location is required").max(120, "Location is too long").nullable().optional(),

    // Stored as JSON arrays on the User model.
    // To keep Prisma JSON-null semantics simple, we do not accept `null` here; use [] to clear.
    links: z
      .array(z.string().trim())
      .max(5, "Maximum 5 links")
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
    languages: z
      .array(z.string().trim())
      .max(50, "Too many languages")
      .optional()
      .transform((v) => (v === undefined ? undefined : uniqStrings(v.filter(Boolean)))),
    contactPreference: z.enum(["discord", "email", "telegram", "x"]).nullable().optional(),
  })
  .refine(
    (v) =>
      v.handle !== undefined ||
      v.name !== undefined ||
      v.image !== undefined ||
      v.headline !== undefined ||
      v.bio !== undefined ||
      v.location !== undefined ||
      v.links !== undefined ||
      v.skills !== undefined ||
      v.tags !== undefined ||
      v.languages !== undefined ||
      v.contactPreference !== undefined,
    {
      message: "At least one field is required",
      path: ["name"],
    },
  );

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const csrf = requireCsrf(req);
    if (!csrf.ok) {
      return errJson({ code: csrf.error.code, message: csrf.error.message, status: csrf.error.status });
    }

    const raw = await req.json().catch(() => null);
    const parsed = UpdateUserSchema.safeParse(raw);

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

    const { updated, handleName } = await db.$transaction(async (tx) => {
      // Claim handle before updating other fields — if this fails, the whole tx rolls back.
      if (input.handle !== undefined) {
        const claim = await claimHandle(tx, {
          ownerType: HandleOwnerType.USER,
          ownerId: userId,
          handle: input.handle,
        });
        if (!claim.ok) throw claim.error;
      }

      const [updated, handleName] = await Promise.all([
        tx.user.update({
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
            ...(input.languages !== undefined ? { languages: input.languages } : {}),
            ...(input.contactPreference !== undefined ? { contactPreference: input.contactPreference } : {}),
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
            languages: true,
            contactPreference: true,
          },
        }),
        resolveHandleNameForOwner(
          { ownerType: HandleOwnerType.USER, ownerId: userId },
          tx,
        ),
      ]);

      return { updated, handleName };
    });

    return okJson<UpdateUserOk>({
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
        languages: Array.isArray(updated.languages) ? (updated.languages as string[]) : [],
        contactPreference: updated.contactPreference,
      },
    });
  } catch (e) {
    // Handle claim errors (thrown as HandleProblem objects).
    if (e && typeof e === "object" && "code" in e && "status" in e && "message" in e) {
      const he = e as HandleProblem;
      if (he.code.startsWith("HANDLE_")) {
        return errJson({
          code: he.code,
          message: he.message,
          status: he.status,
          issues: [{ path: ["handle"], message: he.message }],
          ...(he.meta ? { meta: he.meta } : {}),
        });
      }
    }

    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025") {
      return errJson({ code: "NOT_FOUND", message: "User not found", status: 404 });
    }

    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}
