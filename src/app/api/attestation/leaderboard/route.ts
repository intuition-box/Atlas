import { z } from "zod";

import { HandleOwnerType } from "@prisma/client";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveHandleNamesForOwners } from "@/lib/handle-registry";

export const runtime = "nodejs";

const QuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(10),
});

type LeaderboardEntry = {
  user: {
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
  };
  receivedCount: number;
  givenCount: number;
};

type LeaderboardOk = {
  entries: LeaderboardEntry[];
};

export const GET = api(QuerySchema, async (ctx) => {
  const { take } = ctx.json;

  // Get top users by received attestation count
  const topReceived = await db.attestation.groupBy({
    by: ["toUserId"],
    where: { revokedAt: null, supersededById: null },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take,
  });

  if (topReceived.length === 0) {
    return okJson<LeaderboardOk>({ entries: [] });
  }

  const userIds = topReceived.map((r) => r.toUserId);

  // Fetch given counts for these users too
  const givenCounts = await db.attestation.groupBy({
    by: ["fromUserId"],
    where: {
      fromUserId: { in: userIds },
      revokedAt: null,
      supersededById: null,
    },
    _count: { id: true },
  });

  const givenCountMap = new Map(givenCounts.map((g) => [g.fromUserId, g._count.id]));

  // Fetch user details
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true, avatarUrl: true },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));

  // Resolve handles
  const handleByUserId = await resolveHandleNamesForOwners({
    ownerType: HandleOwnerType.USER,
    ownerIds: userIds,
  });

  const entries: LeaderboardEntry[] = topReceived.map((r) => {
    const user = userMap.get(r.toUserId);
    return {
      user: {
        id: r.toUserId,
        handle: handleByUserId.get(r.toUserId) ?? null,
        name: user?.name ?? null,
        avatarUrl: user?.avatarUrl ?? null,
      },
      receivedCount: r._count.id,
      givenCount: givenCountMap.get(r.toUserId) ?? 0,
    };
  });

  return okJson<LeaderboardOk>({ entries });
}, { methods: ["GET"], auth: "public" });
