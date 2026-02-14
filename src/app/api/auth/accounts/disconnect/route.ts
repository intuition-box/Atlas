import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

/* ────────────────────────────
   Schema
──────────────────────────── */

const schema = z.object({
  provider: z.enum(["twitter"]),
});

/* ────────────────────────────
   Handler
──────────────────────────── */

/**
 * Disconnect a linked OAuth provider from the authenticated user.
 *
 * Only Twitter is unlinkable — Discord is the primary sign-in provider
 * and cannot be disconnected.
 */
export const POST = api(
  schema,
  async (ctx) => {
    const { viewerId, json, requestId } = ctx;
    const userId = viewerId!;
    const { provider } = json;

    // Verify the Account row exists before deleting
    const account = await db.account.findFirst({
      where: { userId, provider },
      select: { id: true },
    });

    if (!account) {
      return errJson({
        code: "NOT_FOUND",
        message: `No ${provider} account linked`,
        status: 404,
        meta: { requestId },
      });
    }

    // Delete the Account row
    await db.account.delete({ where: { id: account.id } });

    // Clear denormalized fields on User
    if (provider === "twitter") {
      await db.user.update({
        where: { id: userId },
        data: { twitterId: null, twitterHandle: null },
        select: { id: true },
      });
    }

    return okJson({ disconnected: true });
  },
  { auth: "onboarded" },
);
