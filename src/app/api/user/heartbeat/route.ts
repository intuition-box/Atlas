import { MembershipStatus } from "@prisma/client";
import { z } from "zod";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

/** Only write to DB if lastActiveAt is older than this threshold. */
const THROTTLE_MS = 5 * 60 * 1000;

const EmptySchema = z.object({});

/**
 * POST /api/user/heartbeat
 *
 * Updates the user's lastActiveAt timestamp (and their approved memberships)
 * to track activity. Self-throttles: skips the write if the value is already
 * fresh (< 5 minutes old).
 */
export const POST = api(EmptySchema, async (ctx) => {
  const { viewerId } = ctx;
  const now = new Date();
  const staleThreshold = new Date(Date.now() - THROTTLE_MS);

  // Atomic conditional update — only writes when stale or null.
  const updated = await db.user.updateMany({
    where: {
      id: viewerId!,
      OR: [
        { lastActiveAt: null },
        { lastActiveAt: { lt: staleThreshold } },
      ],
    },
    data: { lastActiveAt: now },
  });

  // Also touch approved memberships so orbit popovers stay accurate.
  if (updated.count > 0) {
    await db.membership.updateMany({
      where: { userId: viewerId!, status: MembershipStatus.APPROVED },
      data: { lastActiveAt: now },
    });
  }

  return okJson({ ok: true });
}, { auth: "auth" });
