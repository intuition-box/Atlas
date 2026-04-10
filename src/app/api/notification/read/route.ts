import { z } from "zod";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const BodySchema = z.object({
  notificationId: z.string().trim().min(1).optional(),
  all: z.boolean().optional(),
});

type ReadOk = { marked: number };

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const now = new Date();

  if (json.all) {
    const result = await db.notification.updateMany({
      where: { userId: viewerId!, readAt: null },
      data: { readAt: now },
    });
    return okJson<ReadOk>({ marked: result.count });
  }

  if (json.notificationId) {
    await db.notification.updateMany({
      where: { id: json.notificationId, userId: viewerId!, readAt: null },
      data: { readAt: now },
    });
    return okJson<ReadOk>({ marked: 1 });
  }

  return okJson<ReadOk>({ marked: 0 });
}, { auth: "auth" });
