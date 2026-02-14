import { z } from "zod";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

/* ────────────────────────────
   Schema
──────────────────────────── */

const schema = z.object({
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address")
    .optional(),
});

/* ────────────────────────────
   Handler
──────────────────────────── */

/**
 * Unlink a wallet from the authenticated user.
 *
 * - If `address` is provided, only that specific wallet is removed.
 * - If omitted, all wallets for this user are removed.
 * - Updates denormalized User.walletAddress to the next remaining wallet
 *   (most recently linked), or null if none remain.
 */
export const POST = api(
  schema,
  async (ctx) => {
    const { viewerId, json } = ctx;
    // auth: 'onboarded' guarantees viewerId is non-null
    const userId = viewerId!;
    const address = json.address?.toLowerCase();

    if (address) {
      await db.wallet.deleteMany({
        where: { userId, address },
      });
    } else {
      await db.wallet.deleteMany({ where: { userId } });
    }

    // Update denormalized walletAddress to the most recent remaining wallet
    const remaining = await db.wallet.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { address: true },
    });

    await db.user.update({
      where: { id: userId },
      data: { walletAddress: remaining?.address ?? null },
    });

    return okJson({ unlinked: true });
  },
  { auth: "onboarded" },
);
