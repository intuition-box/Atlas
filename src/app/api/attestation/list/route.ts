import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { ApiResponse } from "@/types/api";

import { db } from "@/lib/database";
import { requireApprovedMember, requireUser } from "@/lib/permissions";

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

const Query = z.object({
  communityId: z.string().min(1),
  toUserId: z.string().min(1).optional(),
  fromUserId: z.string().min(1).optional(),
  take: z.coerce.number().int().optional(),
  cursor: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    // NOTE: `userId` used to mean `toUserId` — we no longer support it.
    const raw = {
      communityId: sp.get("communityId") || undefined,
      toUserId: sp.get("toUserId") || undefined,
      fromUserId: sp.get("fromUserId") || undefined,
      take: sp.get("take") || undefined,
      cursor: sp.get("cursor") || undefined,
    };

    const parsed = Query.safeParse(raw);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const { communityId, toUserId, fromUserId, cursor } = parsed.data;
    const take = Math.max(1, Math.min(100, parsed.data.take ?? 50));

    const community = await db.community.findUnique({
      where: { id: communityId },
      select: { isPublicDirectory: true },
    });

    if (!community) return jsonFail(404, "Community not found");

    // Hybrid access rule:
    // - Public directory communities: list is public
    // - Private communities: only approved members can list
    if (!community.isPublicDirectory) {
      const { userId } = await requireUser();
      await requireApprovedMember({ userId, communityId });
    }

    const rows = await db.attestation.findMany({
      where: {
        communityId,
        ...(toUserId ? { toUserId } : {}),
        ...(fromUserId ? { fromUserId } : {}),
      },
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        communityId: true,
        type: true,
        note: true,
        confidence: true,
        createdAt: true,
        fromUser: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            headline: true,
          },
        },
        toUser: {
          select: {
            id: true,
            handle: true,
            name: true,
            avatarUrl: true,
            headline: true,
          },
        },
      },
    });

    const hasMore = rows.length > take;
    const attestations = hasMore ? rows.slice(0, take) : rows;
    const nextCursor = hasMore ? attestations[attestations.length - 1]?.id ?? null : null;

    return jsonOk({ attestations, nextCursor });
  } catch (err) {
    const e = err as StatusError;

    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}