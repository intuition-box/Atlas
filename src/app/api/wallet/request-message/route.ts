import { randomUUID } from "crypto";
import { z } from "zod";

import { api, okJson } from "@/lib/api/server";

export const runtime = "nodejs";

/* ────────────────────────────
   Schema
──────────────────────────── */

const schema = z.object({
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address"),
});

/* ────────────────────────────
   Handler
──────────────────────────── */

/**
 * Generate a nonce-bound message for wallet linking.
 *
 * The message embeds the user ID, address, timestamp, and a random nonce
 * so the server can verify all four fields when the signed message is
 * returned via POST /api/wallet/link.
 */
export const POST = api(
  schema,
  async (ctx) => {
    const { viewerId, json } = ctx;
    // auth: 'onboarded' guarantees viewerId is non-null
    const userId = viewerId!;
    const addr = json.address.toLowerCase();
    const nonce = randomUUID();
    const ts = Date.now();
    const validUntil = ts + 5 * 60 * 1000; // 5 minutes

    const message = `Link wallet ${addr} to user ${userId} at ${ts} nonce:${nonce}`;

    return okJson({ message, ts, nonce, validUntil });
  },
  { auth: "onboarded" },
);
