import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { ApiResponse } from "@/types/api";

import { db } from "@/lib/database";
import { recomputeMemberScores } from "@/lib/scoring";
import { requireCommunityRole, requireUser } from "@/lib/permissions";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

const Body = z.object({
  communityId: z.string().min(1),
  userId: z.string().min(1), // applicant userId
  action: z.enum(["APPROVE", "REJECT"]),
});

type StatusError = Error & { status?: number };

function jsonOk<T>(data: T, status = 200) {
  return NextResponse.json<ApiResponse<T>>(
    { success: true, data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

function jsonFail(status: number, message: string, details?: unknown) {
  return NextResponse.json<ApiResponse<never>>(
    { success: false, error: { code: status, message, details } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  try {
    await requireCsrf(req);

    const { userId: actorId } = await requireUser();

    const json = await req.json().catch(() => null);
    if (!json) return jsonFail(400, "Invalid JSON body");

    const parsed = Body.safeParse(json);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const { communityId, userId: applicantId, action } = parsed.data;

    await requireCommunityRole({
      userId: actorId,
      communityId,
      minRole: "ADMIN",
    });

    const nextStatus = action === "APPROVE" ? "APPROVED" : "REJECTED";

    const changed = await db.$transaction(async (tx) => {
      const app = await tx.application.findUnique({
        where: { userId_communityId: { userId: applicantId, communityId } },
        select: { status: true },
      });

      if (!app) return { changed: false, missing: true } as const;

      // Idempotency: if already in the desired state, do nothing.
      if (app.status === nextStatus) return { changed: false, missing: false } as const;

      await tx.application.update({
        where: { userId_communityId: { userId: applicantId, communityId } },
        data: { status: nextStatus, reviewerId: actorId, reviewedAt: new Date() },
      });

      // Membership should exist once someone applied; treat missing as a bad state.
      await tx.membership.update({
        where: { userId_communityId: { userId: applicantId, communityId } },
        data: {
          status: nextStatus,
          approvedAt: action === "APPROVE" ? new Date() : null,
        },
      });

      await tx.activityEvent.create({
        data: {
          communityId,
          actorId,
          subjectUserId: applicantId,
          type: action === "APPROVE" ? "APPROVED" : "REJECTED",
        },
      });

      return { changed: true, missing: false } as const;
    });

    if (changed.missing) return jsonFail(404, "Application not found");

    // Lightweight recompute (kept outside the tx)
    if (changed.changed) {
      await recomputeMemberScores({ communityId, userId: applicantId });
    }

    return jsonOk({ ok: true });
  } catch (err) {
    const e = err as StatusError;

    // If a library throws a Response (rare but possible), forward it.
    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}