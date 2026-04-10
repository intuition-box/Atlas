import { HandleOwnerType } from "@prisma/client";
import { z } from "zod";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveHandleNamesForOwners } from "@/lib/handle-registry";

export const runtime = "nodejs";

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
  take: z.coerce.number().int().min(1).max(20).default(10),
  /** Include membership status for this community in results. */
  communityId: z.string().trim().min(1).optional(),
});

type UserSearchItem = {
  id: string;
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
  isMember?: boolean;
};

type UserSearchOk = {
  users: UserSearchItem[];
};

export const GET = api(QuerySchema, async (ctx) => {
  const { json } = ctx;
  const { q, take, communityId } = json;

  // Find user IDs that match by handle name
  const handleMatches = await db.handleOwner.findMany({
    where: {
      ownerType: "USER",
      handle: { name: { contains: q, mode: "insensitive" } },
    },
    select: { ownerId: true },
    take,
  });
  const handleMatchIds = handleMatches.map((h) => h.ownerId);

  const rows = await db.user.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        ...(handleMatchIds.length > 0 ? [{ id: { in: handleMatchIds } }] : []),
      ],
    },
    take,
    select: {
      id: true,
      name: true,
      avatarUrl: true,
    },
  });

  if (rows.length === 0) {
    return okJson<UserSearchOk>({ users: [] });
  }

  const handleByUserId = await resolveHandleNamesForOwners({
    ownerType: HandleOwnerType.USER,
    ownerIds: rows.map((r) => r.id),
  });

  // Check membership status if communityId provided
  let memberIds: Set<string> | null = null;
  if (communityId) {
    const members = await db.membership.findMany({
      where: {
        communityId,
        status: "APPROVED",
        userId: { in: rows.map((r) => r.id) },
      },
      select: { userId: true },
    });
    memberIds = new Set(members.map((m) => m.userId));
  }

  const users: UserSearchItem[] = rows.map((r) => ({
    id: r.id,
    handle: handleByUserId.get(r.id) ?? null,
    name: r.name,
    avatarUrl: r.avatarUrl,
    ...(memberIds ? { isMember: memberIds.has(r.id) } : {}),
  }));

  return okJson<UserSearchOk>({ users });
}, { methods: ["GET"], auth: "onboarded" });
