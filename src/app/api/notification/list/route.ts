import { z } from "zod";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const QuerySchema = z.object({
  take: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().trim().min(1).optional(),
});

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string | null;
  metadata: unknown;
  readAt: string | null;
  createdAt: string;
};

type NotificationListOk = {
  notifications: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
};

export const GET = api(QuerySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { take, cursor } = json;

  const [rows, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId: viewerId! },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        metadata: true,
        readAt: true,
        createdAt: true,
      },
    }),
    db.notification.count({
      where: { userId: viewerId!, readAt: null },
    }),
  ]);

  const page = rows.slice(0, take);
  const nextCursor = rows.length > take ? rows[take]!.id : null;

  const notifications: NotificationItem[] = page.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    metadata: n.metadata,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  }));

  return okJson<NotificationListOk>({ notifications, nextCursor, unreadCount });
}, { methods: ["GET"], auth: "auth" });
