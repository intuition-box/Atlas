import { z } from "zod";
import { HandleOwnerType, MembershipStatus } from "@prisma/client";

import { NextResponse, type NextRequest } from "next/server";

import type { ApiEnvelope, ApiError, ApiIssue } from "@/lib/api-shapes";
import { errEnvelope, okEnvelope } from "@/lib/api-shapes";
import { db } from "@/lib/database";
import { resolveCommunityIdFromHandle } from "@/lib/handle-registry";
import { requireAuth } from "@/lib/guards";

export const runtime = "nodejs";

type CommunityGetOk = {
  community: {
    id: string;
    handle: string;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    isApplicationOpen: boolean;
    applicationConfig: unknown | null;
    orbitConfig: unknown | null;
  };
};

const QuerySchema = z
  .object({
    communityId: z.string().min(1).optional(),
    handle: z.string().min(1).optional(),
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

export async function GET(req: NextRequest): Promise<NextResponse<ApiEnvelope<CommunityGetOk>>> {
  const parsed = QuerySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return jsonError({
      code: "INVALID_REQUEST",
      message: "Invalid request",
      status: 400,
      issues: zodIssues(parsed.error),
    });
  }

  const { communityId: rawId, handle: rawHandle } = parsed.data;

  const communityId = rawId ?? (rawHandle ? await resolveCommunityIdFromHandle(rawHandle) : null);
  if (!communityId) {
    return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  const row = await db.community.findUnique({
    where: { id: communityId },
    select: {
      id: true,
      name: true,
      description: true,
      avatarUrl: true,
      isApplicationOpen: true,
      isPublicDirectory: true,
      applicationConfig: true,
      orbitConfig: true,
    },
  });

  if (!row) {
    return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  const owner = await db.handleOwner.findUnique({
    where: {
      ownerType_ownerId: {
        ownerType: HandleOwnerType.COMMUNITY,
        ownerId: row.id,
      },
    },
    select: { handle: { select: { name: true } } },
  });

  if (!owner) {
    return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  // Privacy: if not in public directory, only APPROVED members may fetch.
  if (!row.isPublicDirectory) {
    let userId: string | null = null;
    try {
      ({ userId } = await requireAuth());
    } catch {
      // Treat unauthenticated as not found to avoid leaking private communities.
      return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    const membership = await db.membership.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: { status: true },
    });

    if (!membership || membership.status !== MembershipStatus.APPROVED) {
      return jsonError({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }
  }

  const body = okEnvelope<CommunityGetOk>({
    community: {
      id: row.id,
      handle: owner.handle.name,
      name: row.name,
      description: row.description,
      avatarUrl: row.avatarUrl,
      isApplicationOpen: row.isApplicationOpen,
      applicationConfig: (row.applicationConfig as unknown) ?? null,
      orbitConfig: (row.orbitConfig as unknown) ?? null,
    },
  });

  const res = NextResponse.json(body, { status: 200 });
  res.headers.set("cache-control", "no-store");
  return res;
}
