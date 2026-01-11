import { ActivityType, MembershipRole, MembershipStatus } from "@prisma/client";
import { z } from "zod";

import { NextResponse, type NextRequest } from "next/server";

import type { ApiEnvelope, ApiError, ApiIssue } from "@/lib/api-shapes";
import { errEnvelope, okEnvelope } from "@/lib/api-shapes";
import { db } from "@/lib/database";
import { requireAuth } from "@/lib/guards";
import { resolveCommunityIdFromHandle } from "@/lib/handle-registry";
import { requireCsrf } from "@/lib/security/csrf";

export const runtime = "nodejs";

type JoinCommunityOk = {
  communityId: string;
  membershipId: string;
  status: MembershipStatus;
};

const JoinCommunitySchema = z
  .object({
    communityId: z.string().min(1).optional(),
    handle: z.string().min(1).optional(),
    note: z.string().max(500).optional(),
  })
  .refine((v) => Boolean(v.communityId || v.handle), {
    message: "communityId or handle is required",
    path: ["communityId"],
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

export async function POST(req: NextRequest): Promise<NextResponse<ApiEnvelope<JoinCommunityOk>>> {
  const { userId } = await requireAuth();

  const csrf = requireCsrf(req);
  if (!csrf.ok) return jsonError(csrf.error);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return jsonError({ code: "INVALID_REQUEST", message: "Invalid JSON", status: 400 });
  }

  const parsed = JoinCommunitySchema.safeParse(raw);
  if (!parsed.success) {
    return jsonError({
      code: "INVALID_REQUEST",
      message: "Invalid request",
      status: 400,
      issues: zodIssues(parsed.error),
    });
  }

  const input = parsed.data;

  const communityId =
    input.communityId ?? (input.handle ? await resolveCommunityIdFromHandle(input.handle) : null);

  if (!communityId) {
    return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  const community = await db.community.findUnique({
    where: { id: communityId },
    select: {
      id: true,
      isApplicationOpen: true,
    },
  });

  if (!community) {
    return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  if (!community.isApplicationOpen) {
    return jsonError({
      code: "APPLICATION_CLOSED",
      message: "This community is not accepting new members.",
      status: 409,
    });
  }

  const now = new Date();

  const existing = await db.membership.findUnique({
    where: { userId_communityId: { userId, communityId } },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === MembershipStatus.BANNED) {
      return jsonError({ code: "FORBIDDEN", message: "You are banned from this community.", status: 403 });
    }

    // Repeated joins count as activity, but do not create additional JOINED events.
    await db.membership.update({
      where: { id: existing.id },
      data: { lastActiveAt: now },
      select: { id: true },
    });

    const body = okEnvelope<JoinCommunityOk>({
      communityId,
      membershipId: existing.id,
      status: existing.status,
    });
    const res = NextResponse.json(body, { status: 200 });
    res.headers.set("cache-control", "no-store");
    return res;
  }

  // Create a pending membership application and record a single JOINED event.
  // Scores default to 0; role/status are explicit.
  const created = await db.$transaction(async (tx) => {
    const membership = await tx.membership.create({
      data: {
        userId,
        communityId,
        role: MembershipRole.MEMBER,
        status: MembershipStatus.PENDING,
        lastActiveAt: now,
        ...(input.note ? { note: input.note } : {}),
      },
      select: { id: true, status: true },
    });

    await tx.activityEvent.create({
      data: {
        communityId,
        actorId: userId,
        type: ActivityType.JOINED,
        // Keep metadata minimal; we can expand later if needed.
      },
      select: { id: true },
    });

    return membership;
  });

  const body = okEnvelope<JoinCommunityOk>({
    communityId,
    membershipId: created.id,
    status: created.status,
  });

  const res = NextResponse.json(body, { status: 200 });
  res.headers.set("cache-control", "no-store");
  return res;
}
