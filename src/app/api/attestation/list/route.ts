import type { NextRequest } from "next/server";
import { z } from "zod";

import { AttestationType, HandleOwnerType, MembershipStatus } from "@prisma/client";

import {
  resolveCommunityIdFromHandle,
  resolveHandleNamesForOwners,
  resolveUserIdFromHandle,
} from "@/lib/handle-registry";
import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const QuerySchema = z.object({
  // Prefer ids when provided; handles are supported for convenience.
  communityId: z.string().trim().min(1).optional(),
  communityHandle: z.string().trim().min(1).optional(),

  // Filter by receiver / author.
  toUserId: z.string().trim().min(1).optional(),
  fromUserId: z.string().trim().min(1).optional(),
  toHandle: z.string().trim().min(1).optional(),
  fromHandle: z.string().trim().min(1).optional(),

  type: z.nativeEnum(AttestationType).optional(),

  take: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).optional(),
});

type AttestationListItem = {
  id: string;
  communityId: string;
  type: AttestationType;
  note: string | null;
  confidence: number | null;
  createdAt: string;
  fromUser: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
    headline: string | null;
  };
  toUser: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
    headline: string | null;
  };
};

type AttestationListOk = {
  attestations: AttestationListItem[];
  nextCursor: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const parsed = QuerySchema.safeParse({
      communityId: sp.get("communityId") ?? undefined,
      communityHandle: sp.get("communityHandle") ?? undefined,

      toUserId: sp.get("toUserId") ?? undefined,
      fromUserId: sp.get("fromUserId") ?? undefined,
      toHandle: sp.get("toHandle") ?? undefined,
      fromHandle: sp.get("fromHandle") ?? undefined,

      type: sp.get("type") ?? undefined,
      take: sp.get("take") ?? undefined,
      cursor: sp.get("cursor") ?? undefined,
    });

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

    const { type, cursor } = parsed.data;
    const take = parsed.data.take ?? 50;

    let communityId = parsed.data.communityId ?? null;
    if (!communityId && parsed.data.communityHandle) {
      const resolved = await resolveCommunityIdFromHandle(parsed.data.communityHandle);
      if (!resolved.ok) return errJson(resolved.error);
      communityId = resolved.value;
    }

    let toUserId = parsed.data.toUserId ?? null;
    if (!toUserId && parsed.data.toHandle) {
      const resolved = await resolveUserIdFromHandle(parsed.data.toHandle);
      if (!resolved.ok) return errJson(resolved.error);
      toUserId = resolved.value;
    }

    let fromUserId = parsed.data.fromUserId ?? null;
    if (!fromUserId && parsed.data.fromHandle) {
      const resolved = await resolveUserIdFromHandle(parsed.data.fromHandle);
      if (!resolved.ok) return errJson(resolved.error);
      fromUserId = resolved.value;
    }

    if (!communityId) {
      return errJson({ code: "INVALID_REQUEST", message: "Invalid request", status: 400 });
    }

    // Community visibility gate: if not public, require membership.
    const community = await db.community.findUnique({
      where: { id: communityId },
      select: { id: true, isPublicDirectory: true },
    });

    if (!community) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    if (!community.isPublicDirectory) {
      const session = await auth();
      const userId = session?.user?.id;

      if (!userId) {
        return errJson({ code: "UNAUTHORIZED", message: "Sign in required", status: 401 });
      }

      const member = await db.membership.findUnique({
        where: { userId_communityId: { userId, communityId } },
        select: { id: true, status: true },
      });

      if (!member || member.status !== MembershipStatus.APPROVED) {
        return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
      }
    }

    const rows = await db.attestation.findMany({
      where: {
        communityId,
        ...(toUserId ? { toUserId } : {}),
        ...(fromUserId ? { fromUserId } : {}),
        ...(type ? { type } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        communityId: true,
        fromUserId: true,
        toUserId: true,
        type: true,
        note: true,
        confidence: true,
        createdAt: true,
        fromUser: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            headline: true,
          },
        },
        toUser: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            headline: true,
          },
        },
      },
    });

    const page = rows.slice(0, take);
    const nextCursor = rows.length > take ? rows[take]!.id : null;

    if (page.length === 0) {
      return okJson<AttestationListOk>({ attestations: [], nextCursor });
    }

    // Fetch canonical handles (best-effort) for involved users.
    const userIds = Array.from(
      new Set(page.flatMap((a) => [a.fromUserId, a.toUserId])),
    );

    const handleByUserId = await resolveHandleNamesForOwners({
      ownerType: HandleOwnerType.USER,
      ownerIds: userIds,
    });

    const attestations: AttestationListItem[] = page.map((a) => {
      const fromHandle = handleByUserId.get(a.fromUserId) ?? null;
      const toHandle = handleByUserId.get(a.toUserId) ?? null;

      return {
        id: a.id,
        communityId: a.communityId,
        type: a.type,
        note: a.note,
        confidence: a.confidence,
        createdAt: a.createdAt.toISOString(),
        fromUser: {
          id: a.fromUser.id,
          handle: fromHandle,
          name: a.fromUser.name,
          avatarUrl: a.fromUser.avatarUrl,
          headline: a.fromUser.headline,
        },
        toUser: {
          id: a.toUser.id,
          handle: toHandle,
          name: a.toUser.name,
          avatarUrl: a.toUser.avatarUrl,
          headline: a.toUser.headline,
        },
      };
    });

    return okJson<AttestationListOk>({ attestations, nextCursor });
  } catch {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}