import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";

import type { ApiResponse } from "@/types/api";

import { db } from "@/lib/database";
import { recomputeMemberScores } from "@/lib/scoring";
import { requireUser } from "@/lib/permissions";
import { requireCsrf } from "@/lib/security/csrf";
import { ApplicationSubmitSchema } from "@/lib/validation/application";

export const runtime = "nodejs";

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

    const { userId } = await requireUser();

    const json = await req.json().catch(() => null);
    if (!json) return jsonFail(400, "Invalid JSON body");

    const parsed = ApplicationSubmitSchema.safeParse(json);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const body = parsed.data;

    const existing = await db.membership.findUnique({
      where: { userId_communityId: { userId, communityId: body.communityId } },
      select: { status: true },
    });

    if (existing?.status === "APPROVED") {
      return jsonFail(409, "You are already approved in this community.");
    }

    if (existing?.status === "BANNED") {
      return jsonFail(403, "You are banned from this community.");
    }

    const result = await db.$transaction(async (tx) => {
      // Ensure membership exists
      await tx.membership.upsert({
        where: { userId_communityId: { userId, communityId: body.communityId } },
        create: {
          userId,
          communityId: body.communityId,
          status: "PENDING",
          role: "MEMBER",
          orbitLevel: "EXPLORER",
          lastActiveAt: new Date(),
        },
        update: {
          status: "PENDING",
          lastActiveAt: new Date(),
        },
      });

      // Determine whether we should create an activity event (idempotent)
      const prev = await tx.application.findUnique({
        where: { userId_communityId: { userId, communityId: body.communityId } },
        select: { status: true },
      });

      // Single active application per user/community (unique index)
      await tx.application.upsert({
        where: { userId_communityId: { userId, communityId: body.communityId } },
        create: {
          userId,
          communityId: body.communityId,
          status: "SUBMITTED",
          answers: body.answers as unknown as Prisma.InputJsonValue,
        },
        update: {
          status: "SUBMITTED",
          answers: body.answers as unknown as Prisma.InputJsonValue,
          reviewerId: null,
          reviewedAt: null,
        },
      });

      // Only create the APPLIED event when transitioning into SUBMITTED.
      if (!prev || prev.status !== "SUBMITTED") {
        await tx.activityEvent.create({
          data: {
            communityId: body.communityId,
            actorId: userId,
            type: "APPLIED",
          },
        });
      }

      return { createdEvent: !prev || prev.status !== "SUBMITTED" };
    });

    // Keep recompute outside the transaction
    await recomputeMemberScores({ communityId: body.communityId, userId });

    return jsonOk({ ok: true, submitted: true, createdEvent: result.createdEvent });
  } catch (err) {
    const e = err as StatusError;

    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}