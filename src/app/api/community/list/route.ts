import { NextResponse, type NextRequest } from "next/server";

import type { ApiResponse } from "@/types/api";

import { MembershipStatus } from "@prisma/client";
import { db } from "@/lib/database";
import { requireUser } from "@/lib/permissions";
import { CommunityListSchema } from "@/lib/validation/community";

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
      take: sp.get("take") ? Number(sp.get("take")) : undefined,
      includePrivate: sp.get("includePrivate") === "true" ? true : undefined,
    };

    const parsed = CommunityListSchema.safeParse(raw);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const take = Math.max(1, Math.min(100, parsed.data.take ?? 24));
    const includePrivate = parsed.data.includePrivate === true;

    // Default: list only public communities.
    // If includePrivate=true: include private communities ONLY when the caller is a member.
    let where;

    if (!includePrivate) {
      where = { isPublicDirectory: true };
    } else {
      const { userId } = await requireUser();
      where = {
        OR: [
          { isPublicDirectory: true },
          {
            isPublicDirectory: false,
            memberships: {
              some: {
                userId,
                // Don’t leak private communities to banned users.
                status: { in: [MembershipStatus.APPROVED, MembershipStatus.PENDING] },
              },
            },
          },
        ],
      };
    }

    const communities = await db.community.findMany({
      take,
      orderBy: { createdAt: "desc" },
      where,
      select: {
        id: true,
        handle: true,
        name: true,
        description: true,
        avatarUrl: true,
        isPublicDirectory: true,
        _count: { select: { memberships: true } },
      },
    });

    return jsonOk({ communities });
  } catch (err) {
    const e = err as StatusError;

    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}