import type { NextRequest } from "next/server";
import { z } from "zod";

import { HandleOwnerType } from "@prisma/client";

import {
  resolveHandleNamesForOwners,
  resolveUserIdFromHandle,
} from "@/lib/handle-registry";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { ATTESTATION_TYPES, type AttestationType } from "@/config/attestations";

export const runtime = "nodejs";

const attestationTypeValues = Object.keys(ATTESTATION_TYPES) as [AttestationType, ...AttestationType[]];

const QuerySchema = z.object({
  // Filter by receiver / author.
  toUserId: z.string().trim().min(1).optional(),
  fromUserId: z.string().trim().min(1).optional(),
  toHandle: z.string().trim().min(1).optional(),
  fromHandle: z.string().trim().min(1).optional(),

  type: z.enum(attestationTypeValues).optional(),

  take: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).optional(),
});

type AttestationListItem = {
  id: string;
  type: AttestationType;
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

    // Require at least one filter to avoid fetching all attestations.
    if (!toUserId && !fromUserId) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "At least one of toUserId, fromUserId, toHandle, or fromHandle is required",
        status: 400,
      });
    }

    const rows = await db.attestation.findMany({
      where: {
        ...(toUserId ? { toUserId } : {}),
        ...(fromUserId ? { fromUserId } : {}),
        ...(type ? { type } : {}),
        revokedAt: null, // Only active attestations
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
        fromUserId: true,
        toUserId: true,
        type: true,
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
        type: a.type as AttestationType,
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
