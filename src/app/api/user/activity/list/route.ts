import { HandleOwnerType, EventType } from "@prisma/client";
import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import {
  resolveUserIdFromHandle,
  resolveHandleNamesForOwners,
} from "@/lib/handle-registry";

export const runtime = "nodejs";

/** Event types excluded from the user feed (too noisy / shown elsewhere). */
const EXCLUDED_TYPES: EventType[] = [
  EventType.PROFILE_UPDATED,
  EventType.COMMUNITY_CREATED,
  EventType.COMMUNITY_UPDATED,
];

const ALLOWED_TYPES = Object.values(EventType).filter(
  (t) => !EXCLUDED_TYPES.includes(t),
) as [string, ...string[]];

const QuerySchema = z.object({
  handle: z.string().trim().min(1),
  take: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().trim().min(1).optional(),
  type: z.enum(ALLOWED_TYPES).optional(),
});

// ── Response types ──────────────────────────────────────────────

type ActivityUser = {
  id: string;
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
};

type ActivityCommunity = {
  id: string;
  handle: string | null;
  name: string;
};

type UserActivityEvent = {
  id: string;
  type: string;
  createdAt: string;
  actor: ActivityUser;
  subject: ActivityUser | null;
  metadata: Record<string, unknown> | null;
  community: ActivityCommunity | null;
};

type UserActivityListOk = {
  events: UserActivityEvent[];
  nextCursor: string | null;
};

// ── Handler ─────────────────────────────────────────────────────

export const GET = api(QuerySchema, async (ctx) => {
  const { handle, take, cursor, type } = ctx.json;

  // 1. Resolve user
  const resolved = await resolveUserIdFromHandle(handle);
  if (!resolved.ok) return errJson(resolved.error);
  const userId = resolved.value;

  // 2. Build cursor filter
  let cursorDate: Date | undefined;
  if (cursor) {
    const [ts] = cursor.split("|");
    const parsed = Date.parse(ts!);
    if (Number.isFinite(parsed)) {
      cursorDate = new Date(parsed);
    }
  }

  // 3. Query events where user is actor OR subject
  const rows = await db.event.findMany({
    where: {
      OR: [{ actorId: userId }, { subjectUserId: userId }],
      type: type ? (type as EventType) : { notIn: EXCLUDED_TYPES },
      ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take + 1,
    select: {
      id: true,
      type: true,
      actorId: true,
      subjectUserId: true,
      communityId: true,
      metadata: true,
      createdAt: true,
    },
  });

  // 4. Paginate
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  // 5. Collect all user IDs for batch resolution
  const userIds = new Set<string>();
  for (const row of page) {
    userIds.add(row.actorId);
    if (row.subjectUserId) userIds.add(row.subjectUserId);
    const meta = row.metadata as Record<string, unknown> | null;
    if (meta?.subjectUserId && typeof meta.subjectUserId === "string") {
      userIds.add(meta.subjectUserId);
    }
  }

  const userIdArray = [...userIds];

  // 6. Collect community IDs for context
  const communityIds = [...new Set(page.map((r) => r.communityId))];

  // 7. Batch-resolve user profiles, user handles, communities, and community handles
  const [users, userHandles, communities, communityHandles] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIdArray } },
      select: { id: true, name: true, avatarUrl: true, image: true },
    }),
    resolveHandleNamesForOwners({
      ownerType: HandleOwnerType.USER,
      ownerIds: userIdArray,
    }),
    db.community.findMany({
      where: { id: { in: communityIds } },
      select: { id: true, name: true },
    }),
    resolveHandleNamesForOwners({
      ownerType: HandleOwnerType.COMMUNITY,
      ownerIds: communityIds,
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));
  const communityById = new Map(communities.map((c) => [c.id, c]));

  function toActivityUser(id: string): ActivityUser {
    const u = userById.get(id);
    return {
      id,
      handle: userHandles.get(id) ?? null,
      name: u?.name ?? null,
      avatarUrl: u?.avatarUrl ?? u?.image ?? null,
    };
  }

  function toActivityCommunity(id: string): ActivityCommunity | null {
    const c = communityById.get(id);
    if (!c) return null;
    return {
      id,
      handle: communityHandles.get(id) ?? null,
      name: c.name,
    };
  }

  // 8. Build response
  const events: UserActivityEvent[] = page.map((row) => {
    const meta = row.metadata as Record<string, unknown> | null;
    const subjectId =
      row.subjectUserId ??
      (typeof meta?.subjectUserId === "string" ? meta.subjectUserId : null);

    return {
      id: row.id,
      type: row.type,
      createdAt: row.createdAt.toISOString(),
      actor: toActivityUser(row.actorId),
      subject: subjectId ? toActivityUser(subjectId) : null,
      metadata: meta,
      community: toActivityCommunity(row.communityId),
    };
  });

  const lastRow = page[page.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? `${lastRow.createdAt.toISOString()}|${lastRow.id}`
      : null;

  return okJson<UserActivityListOk>({ events, nextCursor });
}, { methods: ["GET"], auth: "public" });
