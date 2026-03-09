import { z } from "zod";

import { HandleOwnerType } from "@prisma/client";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import {
  resolveHandleNamesForOwners,
  resolveUserIdFromHandle,
} from "@/lib/handle-registry";
import { ATTESTATION_TYPES, type AttestationType } from "@/lib/attestations/definitions";

export const runtime = "nodejs";

const attestationTypeValues = Object.keys(ATTESTATION_TYPES) as [AttestationType, ...AttestationType[]];

const QuerySchema = z.object({
  // Filter by receiver / author
  toUserId: z.string().trim().min(1).optional(),
  fromUserId: z.string().trim().min(1).optional(),
  toHandle: z.string().trim().min(1).optional(),
  fromHandle: z.string().trim().min(1).optional(),

  type: z.enum(attestationTypeValues).optional(),
  minted: z.enum(["true", "false"]).optional(),

  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
});

type AttestationListItem = {
  id: string;
  type: AttestationType;
  attributeId: string | null;
  stance: string | null;
  confidence: number | null;
  createdAt: string;
  mintedAt: string | null;
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
    walletAddress: string | null;
  };
};

type AttestationListOk = {
  attestations: AttestationListItem[];
  nextCursor: string | null;
};

export const GET = api(QuerySchema, async (ctx) => {
  const { json } = ctx;
  const { type, cursor, take } = json;

  // Resolve handles to user IDs
  let toUserId = json.toUserId ?? null;
  if (!toUserId && json.toHandle) {
    const resolved = await resolveUserIdFromHandle(json.toHandle);
    if (!resolved.ok) return errJson(resolved.error);
    toUserId = resolved.value;
  }

  let fromUserId = json.fromUserId ?? null;
  if (!fromUserId && json.fromHandle) {
    const resolved = await resolveUserIdFromHandle(json.fromHandle);
    if (!resolved.ok) return errJson(resolved.error);
    fromUserId = resolved.value;
  }

  // Require at least one filter to avoid fetching all attestations
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
      ...(json.minted === "true" ? { mintedAt: { not: null } } : {}),
      ...(json.minted === "false" ? { mintedAt: null } : {}),
      revokedAt: null, // Only active attestations
      supersededById: null, // Only current versions
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
      attributeId: true,
      stance: true,
      confidence: true,
      createdAt: true,
      mintedAt: true,
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
          walletAddress: true,
        },
      },
    },
  });

  const page = rows.slice(0, take);
  const nextCursor = rows.length > take ? rows[take]!.id : null;

  if (page.length === 0) {
    return okJson<AttestationListOk>({ attestations: [], nextCursor });
  }

  // Fetch canonical handles (best-effort) for involved users
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
      attributeId: a.attributeId ?? null,
      stance: a.stance ?? "for",
      confidence: a.confidence,
      createdAt: a.createdAt.toISOString(),
      mintedAt: a.mintedAt?.toISOString() ?? null,
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
        walletAddress: a.toUser.walletAddress,
      },
    };
  });

  return okJson<AttestationListOk>({ attestations, nextCursor });
}, { methods: ["GET"], auth: "public" });
