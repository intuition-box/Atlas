import { HandleOwnerType, HandleStatus } from "@prisma/client";
import { z } from "zod";

import { NextResponse, type NextRequest } from "next/server";

import type { ApiEnvelope, ApiError, ApiIssue } from "@/lib/api-shapes";
import { errEnvelope, okEnvelope } from "@/lib/api-shapes";
import { db } from "@/lib/database";
import { requireAuth } from "@/lib/guards";
import { DEFAULT_COOLDOWN_DAYS, DEFAULT_RECLAIM_DAYS } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type DeleteCommunityOk = {
  communityId: string;
};

const DeleteCommunitySchema = z.object({
  communityId: z.string().min(1, "communityId is required"),
});

type StatusErr = ApiError<string, number, unknown>;

function zodIssues(e: z.ZodError): ApiIssue[] {
  return e.issues.map((iss) => ({
    path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
    message: iss.message,
  }));
}

function jsonError<E extends StatusErr>(e: E): NextResponse<ApiEnvelope<never>> {
  const res = NextResponse.json(errEnvelope(e), { status: e.status });
  res.headers.set("cache-control", "no-store");
  return res;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

export async function POST(req: NextRequest): Promise<NextResponse<ApiEnvelope<DeleteCommunityOk>>> {
  const { userId } = await requireAuth();

  const csrf = requireCsrf(req);
  if (!csrf.ok) return jsonError(csrf.error);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError({ code: "INVALID_REQUEST", message: "Invalid JSON", status: 400 });
  }

  const parsed = DeleteCommunitySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError({
      code: "INVALID_REQUEST",
      message: "Invalid request",
      status: 400,
      issues: zodIssues(parsed.error),
    });
  }

  const { communityId } = parsed.data;

  const now = new Date();
  const reclaimUntil = addDays(now, DEFAULT_COOLDOWN_DAYS);
  const availableAt = addDays(reclaimUntil, DEFAULT_RECLAIM_DAYS);

  const found = await db.community.findUnique({
    where: { id: communityId },
    select: { id: true, ownerId: true },
  });

  if (!found) {
    return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  if (found.ownerId !== userId) {
    return jsonError({ code: "FORBIDDEN", message: "Only the owner can delete this community", status: 403 });
  }

  try {
    await db.$transaction(async (tx) => {
      const mapping = await tx.handleOwner.findUnique({
        where: { ownerType_ownerId: { ownerType: HandleOwnerType.COMMUNITY, ownerId: communityId } },
        select: { handleId: true },
      });

      if (!mapping) {
        throw new Error("HANDLE_MAPPING_MISSING");
      }

      const released = await tx.handle.updateMany({
        where: {
          id: mapping.handleId,
          status: HandleStatus.ACTIVE,
        },
        data: {
          status: HandleStatus.RELEASED,
          lastOwnerType: HandleOwnerType.COMMUNITY,
          lastOwnerId: communityId,
          reclaimUntil,
          availableAt,
        },
      });

      if (released.count !== 1) {
        throw new Error("HANDLE_RELEASE_FAILED");
      }

      await tx.handleOwner.deleteMany({
        where: { handleId: mapping.handleId, ownerType: HandleOwnerType.COMMUNITY, ownerId: communityId },
      });

      // Delete the community.
      await tx.community.delete({ where: { id: communityId } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "HANDLE_RELEASE_FAILED") {
      return jsonError({
        code: "HANDLE_NOT_AVAILABLE",
        message: "Community handle could not be released. Please try again.",
        status: 409,
      });
    }
    if (e instanceof Error && e.message === "HANDLE_MAPPING_MISSING") {
      return jsonError({
        code: "HANDLE_NOT_AVAILABLE",
        message: "Community handle mapping is missing. Please try again.",
        status: 409,
      });
    }
    throw e;
  }

  const body = okEnvelope<DeleteCommunityOk>({ communityId });
  const res = NextResponse.json(body, { status: 200 });
  res.headers.set("cache-control", "no-store");
  return res;
}
