import { NextResponse, type NextRequest } from "next/server";

import type { ApiResponse } from "@/types/api";

import { db } from "@/lib/database";
import { requireApprovedMember, requireUser } from "@/lib/permissions";
import { CommunityGetSchema } from "@/lib/validation/community";

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

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const raw = {
      communityId: sp.get("communityId") || undefined,
      handle: sp.get("handle") || undefined,
    };

    const parsed = CommunityGetSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const { communityId, handle } = parsed.data;

    const community = communityId
      ? await db.community.findUnique({
          where: { id: communityId },
          select: {
            id: true,
            handle: true,
            name: true,
            description: true,
            avatarUrl: true,
            ownerId: true,
            isPublicDirectory: true,
            createdAt: true,
          },
        })
      : await db.community.findUnique({
          where: { handle: handle! },
          select: {
            id: true,
            handle: true,
            name: true,
            description: true,
            avatarUrl: true,
            ownerId: true,
            isPublicDirectory: true,
            createdAt: true,
          },
        });

    if (!community) return jsonFail(404, "Community not found");

    // Hybrid access rule:
    // - Public directory communities: this endpoint is public
    // - Private communities: only approved members can fetch
    if (!community.isPublicDirectory) {
      const { userId } = await requireUser();
      await requireApprovedMember({ userId, communityId: community.id });
    }

    return jsonOk({ community });
  } catch (err) {
    const e = err as StatusError;

    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}