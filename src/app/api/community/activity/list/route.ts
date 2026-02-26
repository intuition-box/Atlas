import { HandleOwnerType, MembershipStatus, EventType } from "@prisma/client";
import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveCommunityIdFromHandle, resolveHandleNamesForOwners } from "@/lib/handle-registry";

export const runtime = "nodejs";

/** Event types excluded from the feed (too noisy / shown elsewhere). */
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

type CommunityActivityEvent = {
  id: string;
  type: string;
  createdAt: string;
  actor: ActivityUser;
  subject: ActivityUser | null;
  metadata: Record<string, unknown> | null;
};

type CommunityActivityListOk = {
  events: CommunityActivityEvent[];
  nextCursor: string | null;
};

// ── Handler ─────────────────────────────────────────────────────

export const GET = api(QuerySchema, async (ctx) => {
  const { handle, take, cursor, type } = ctx.json;
  const viewerId = ctx.viewerId;

  // 1. Resolve community
  const resolved = await resolveCommunityIdFromHandle(handle);
  if (!resolved.ok) return errJson(resolved.error);
  const communityId = resolved.value;

  // 2. Access control (mirrors /api/community/get)
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { ownerId: true, isPublicDirectory: true },
  });

  if (!community) {
    return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
  }

  const isOwner = !!viewerId && community.ownerId === viewerId;
  const membership = viewerId
    ? await db.membership.findUnique({
        where: { userId_communityId: { userId: viewerId, communityId } },
        select: { status: true },
      })
    : null;
  const isApprovedMember = membership?.status === MembershipStatus.APPROVED;
  const canView = community.isPublicDirectory || isApprovedMember || isOwner;

  if (!canView) {
    return errJson({ code: "FORBIDDEN", message: "Not authorized", status: 403 });
  }

  // 3. Build cursor filter
  let cursorDate: Date | undefined;
  if (cursor) {
    const [ts] = cursor.split("|");
    const parsed = Date.parse(ts!);
    if (Number.isFinite(parsed)) {
      cursorDate = new Date(parsed);
    }
  }

  // 4. Query events
  const rows = await db.event.findMany({
    where: {
      communityId,
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
      metadata: true,
      createdAt: true,
    },
  });

  // 5. Paginate
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;

  // 6. Collect all user IDs for batch resolution
  const userIds = new Set<string>();
  for (const row of page) {
    userIds.add(row.actorId);
    if (row.subjectUserId) userIds.add(row.subjectUserId);
    // ROLE_UPDATED and ORBIT_OVERRIDE store subjectUserId in metadata
    const meta = row.metadata as Record<string, unknown> | null;
    if (meta?.subjectUserId && typeof meta.subjectUserId === "string") {
      userIds.add(meta.subjectUserId);
    }
  }

  const userIdArray = [...userIds];

  // 7. Batch-resolve user profiles and handles
  const [users, userHandles] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIdArray } },
      select: { id: true, name: true, avatarUrl: true, image: true },
    }),
    resolveHandleNamesForOwners({
      ownerType: HandleOwnerType.USER,
      ownerIds: userIdArray,
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u]));

  function toActivityUser(id: string): ActivityUser {
    const u = userById.get(id);
    return {
      id,
      handle: userHandles.get(id) ?? null,
      name: u?.name ?? null,
      avatarUrl: u?.avatarUrl ?? u?.image ?? null,
    };
  }

  // 8. Build response
  const events: CommunityActivityEvent[] = page.map((row) => {
    const meta = row.metadata as Record<string, unknown> | null;
    // Resolve subject from column first, then metadata fallback
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
    };
  });

  const lastRow = page[page.length - 1];
  const nextCursor =
    hasMore && lastRow
      ? `${lastRow.createdAt.toISOString()}|${lastRow.id}`
      : null;

  return okJson<CommunityActivityListOk>({ events, nextCursor });
}, { methods: ["GET"], auth: "public" });
