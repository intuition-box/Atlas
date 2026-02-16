import { z } from "zod";

import { HandleOwnerType } from "@prisma/client";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveHandleNamesForOwners } from "@/lib/handle-registry";
import { ATTESTATION_TYPES, type AttestationType } from "@/lib/attestations/definitions";

export const runtime = "nodejs";

const QuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().min(1).optional(),
});

// --- Activity event types ---

type ActivityUser = {
  id: string;
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
};

type AttestationEvent = {
  kind: "attestation";
  id: string;
  createdAt: string;
  fromUser: ActivityUser;
  toUser: ActivityUser;
  attestationType: AttestationType;
  attestationTypeLabel: string;
  mintedAt: string | null;
};

type UserJoinedEvent = {
  kind: "user_joined";
  id: string;
  createdAt: string;
  user: ActivityUser;
};

type CommunityCreatedEvent = {
  kind: "community_created";
  id: string;
  createdAt: string;
  community: {
    id: string;
    handle: string | null;
    name: string;
    icon: string | null;
    avatarUrl: string | null;
  };
  creator: ActivityUser;
};

type ActivityEvent = AttestationEvent | UserJoinedEvent | CommunityCreatedEvent;

type ActivityListOk = {
  events: ActivityEvent[];
  nextCursor: string | null;
};

export const GET = api(QuerySchema, async (ctx) => {
  const { take, cursor } = ctx.json;

  // We fetch `take + buffer` from each source, merge, sort, then take `take + 1`
  // for cursor pagination. Overfetch a bit to handle interleaving.
  const fetchLimit = take + 10;

  // Decode compound cursor: "timestamp|source|id"
  let cursorDate: Date | null = null;
  if (cursor) {
    const [ts] = cursor.split("|");
    const parsed = Date.parse(ts!);
    if (Number.isFinite(parsed)) {
      cursorDate = new Date(parsed);
    }
  }

  const dateFilter = cursorDate ? { lt: cursorDate } : undefined;

  // --- Fetch from multiple sources in parallel ---
  const [attestationRows, userRows, communityRows] = await Promise.all([
    // 1. Recent attestations
    db.attestation.findMany({
      where: {
        revokedAt: null,
        supersededById: null,
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: fetchLimit,
      select: {
        id: true,
        type: true,
        fromUserId: true,
        toUserId: true,
        confidence: true,
        createdAt: true,
        mintedAt: true,
        fromUser: { select: { id: true, name: true, avatarUrl: true } },
        toUser: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),

    // 2. Recently joined users (onboarded)
    db.user.findMany({
      where: {
        onboardedAt: { not: null },
        ...(dateFilter ? { onboardedAt: dateFilter } : {}),
      },
      orderBy: [{ onboardedAt: "desc" }, { id: "desc" }],
      take: fetchLimit,
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        onboardedAt: true,
      },
    }),

    // 3. Recently created communities
    db.community.findMany({
      where: {
        ...(dateFilter ? { createdAt: dateFilter } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: fetchLimit,
      select: {
        id: true,
        name: true,
        icon: true,
        avatarUrl: true,
        ownerId: true,
        createdAt: true,
        owner: { select: { id: true, name: true, avatarUrl: true } },
      },
    }),
  ]);

  // --- Resolve handles for all users and communities ---
  const allUserIds = Array.from(new Set([
    ...attestationRows.flatMap((a) => [a.fromUserId, a.toUserId]),
    ...userRows.map((u) => u.id),
    ...communityRows.map((c) => c.ownerId),
  ]));

  const allCommunityIds = communityRows.map((c) => c.id);

  const [userHandles, communityHandles] = await Promise.all([
    resolveHandleNamesForOwners({
      ownerType: HandleOwnerType.USER,
      ownerIds: allUserIds,
    }),
    allCommunityIds.length > 0
      ? resolveHandleNamesForOwners({
          ownerType: HandleOwnerType.COMMUNITY,
          ownerIds: allCommunityIds,
        })
      : Promise.resolve(new Map<string, string>()),
  ]);

  function toActivityUser(u: { id: string; name: string | null; avatarUrl: string | null }): ActivityUser {
    return {
      id: u.id,
      handle: userHandles.get(u.id) ?? null,
      name: u.name,
      avatarUrl: u.avatarUrl,
    };
  }

  // --- Build unified event list ---
  const events: ActivityEvent[] = [];

  for (const a of attestationRows) {
    const typeKey = a.type as AttestationType;
    const typeInfo = ATTESTATION_TYPES[typeKey];
    events.push({
      kind: "attestation",
      id: `att-${a.id}`,
      createdAt: a.createdAt.toISOString(),
      fromUser: toActivityUser(a.fromUser),
      toUser: toActivityUser(a.toUser),
      attestationType: typeKey,
      attestationTypeLabel: typeInfo?.label ?? a.type,
      mintedAt: a.mintedAt?.toISOString() ?? null,
    });
  }

  for (const u of userRows) {
    if (!u.onboardedAt) continue;
    events.push({
      kind: "user_joined",
      id: `usr-${u.id}`,
      createdAt: u.onboardedAt.toISOString(),
      user: toActivityUser(u),
    });
  }

  for (const c of communityRows) {
    events.push({
      kind: "community_created",
      id: `com-${c.id}`,
      createdAt: c.createdAt.toISOString(),
      community: {
        id: c.id,
        handle: communityHandles.get(c.id) ?? null,
        name: c.name,
        icon: c.icon,
        avatarUrl: c.avatarUrl,
      },
      creator: toActivityUser(c.owner),
    });
  }

  // Sort all events chronologically (newest first)
  events.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Paginate
  const page = events.slice(0, take + 1);
  const hasMore = page.length > take;
  const result = hasMore ? page.slice(0, take) : page;

  const nextCursor = hasMore && result.length > 0
    ? `${result[result.length - 1]!.createdAt}|${result[result.length - 1]!.kind}|${result[result.length - 1]!.id}`
    : null;

  return okJson<ActivityListOk>({ events: result, nextCursor });
}, { methods: ["GET"], auth: "public" });
