import type { NextRequest } from "next/server";
import { z } from "zod";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveCommunityIdFromHandle } from "@/lib/handle-registry";

export const runtime = "nodejs";

const QuerySchema = z
  .object({
    communityId: z.string().trim().min(1).optional(),
    communityHandle: z.string().trim().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.communityId || v.communityHandle) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["communityId"],
      message: "communityId or communityHandle is required",
    });
  });

type ApplicationGetOk = {
  application: {
    id: string;
    status: string;
    answers: unknown;
    createdAt: string;
    updatedAt: string;
    reviewedAt: string | null;
    reviewNote: string | null;
  } | null;
};

/** Return the viewer's application for a community (or null if none exists). */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
    }

    const parsed = QuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries()),
    );

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

    let communityId = parsed.data.communityId ?? null;
    if (!communityId && parsed.data.communityHandle) {
      const resolved = await resolveCommunityIdFromHandle(parsed.data.communityHandle);
      if (!resolved.ok) return errJson(resolved.error);
      communityId = resolved.value;
    }

    if (!communityId) {
      return errJson({ code: "INVALID_REQUEST", message: "Invalid request", status: 400 });
    }

    const app = await db.application.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: {
        id: true,
        status: true,
        answers: true,
        createdAt: true,
        updatedAt: true,
        reviewedAt: true,
        reviewNote: true,
      },
    });

    return okJson<ApplicationGetOk>({
      application: app
        ? {
            id: app.id,
            status: app.status,
            answers: app.answers,
            createdAt: app.createdAt.toISOString(),
            updatedAt: app.updatedAt.toISOString(),
            reviewedAt: app.reviewedAt?.toISOString() ?? null,
            reviewNote: app.reviewNote ?? null,
          }
        : null,
    });
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}
