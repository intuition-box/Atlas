import { NextResponse, type NextRequest } from "next/server";

import type { ApiResponse } from "@/types/api";

import { db } from "@/lib/database";
import { requireUser } from "@/lib/permissions";
import { requireCsrf } from "@/lib/security/csrf";
import { CommunityCreateSchema } from "@/lib/validation/community";

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

    let json: unknown;
    try {
      json = await req.json();
    } catch {
      return jsonFail(400, "Invalid JSON body");
    }

    const parsed = CommunityCreateSchema.safeParse(json);
    if (!parsed.success) {
      return jsonFail(400, "Invalid request", parsed.error.flatten());
    }

    const body = parsed.data;

    const community = await db.$transaction(async (tx) => {
      const created = await tx.community.create({
        data: {
          name: body.name,
          handle: body.handle,
          description: body.description ?? null,
          avatarUrl: body.avatarUrl ?? null,
          isPublicDirectory: body.isPublicDirectory ?? false,
          ownerId: userId,
          memberships: {
            create: {
              userId,
              role: "OWNER",
              status: "APPROVED",
              approvedAt: new Date(),
              orbitLevel: "ADVOCATE",
              loveScore: 5,
              reachScore: 1,
              gravityScore: 5,
              lastActiveAt: new Date(),
            },
          },
          activityEvents: {
            create: { actorId: userId, type: "COMMUNITY_CREATED" },
          },
        },
        select: { id: true, handle: true, name: true },
      });

      return created;
    });

    return jsonOk({ community }, 201);
  } catch (err) {
    const e = err as StatusError;

    if (e instanceof Response) return e;

    const status = typeof e.status === "number" ? e.status : 500;
    const message = status === 500 ? "Internal error" : e.message || "Request failed";
    return jsonFail(status, message);
  }
}