import { z } from "zod";
import { verifyMessage, type Hex } from "viem";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

/* ────────────────────────────
   Schema
──────────────────────────── */

const schema = z.object({
  address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "Invalid Ethereum address"),
  message: z.string().min(1, "Message is required"),
  signature: z.string().min(1, "Signature is required"),
});

/* ────────────────────────────
   Message regex
──────────────────────────── */

/**
 * Expected format from POST /api/wallet/request-message:
 * "Link wallet 0xabc... to user <userId> at <unixMs> nonce:<uuid>"
 */
const MSG_RE =
  /^Link wallet (0x[0-9a-fA-F]{40}) to user ([a-zA-Z0-9_-]+) at (\d+) nonce:([a-f0-9-]+)$/;

/** 5-minute expiry window (matches request-message route). */
const EXPIRY_MS = 5 * 60 * 1000;

/* ────────────────────────────
   Handler
──────────────────────────── */

/**
 * Verify a signed message and link the wallet to the authenticated user.
 *
 * Security checks:
 * 1. Message format matches expected pattern
 * 2. Embedded userId matches session viewerId
 * 3. Embedded address matches provided address
 * 4. Timestamp is within 5-minute window
 * 5. Signature is valid (viem verifyMessage)
 *
 * Database behavior:
 * - Upserts by address (handles re-linking same address or linking to different user)
 * - Updates denormalized User.walletAddress to the most recently linked wallet
 */
export const POST = api(
  schema,
  async (ctx) => {
    const { viewerId, json, requestId } = ctx;
    // auth: 'onboarded' guarantees viewerId is non-null
    const userId = viewerId!;
    const { address, message, signature } = json;

    // 1. Parse message format
    const m = MSG_RE.exec(message);
    if (!m) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Bad message format",
        status: 400,
        meta: { requestId },
      });
    }

    const [, msgAddr, msgUserId, tsStr] = m;

    // 2. Message must be for this user
    if (msgUserId !== userId) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Message user mismatch",
        status: 400,
        meta: { requestId },
      });
    }

    // 3. Message address must match provided address
    if (msgAddr!.toLowerCase() !== address.toLowerCase()) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Message address mismatch",
        status: 400,
        meta: { requestId },
      });
    }

    // 4. Check expiry (5 minutes)
    const ts = Number(tsStr);
    if (!ts || Math.abs(Date.now() - ts) > EXPIRY_MS) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Message expired",
        status: 400,
        meta: { requestId },
      });
    }

    // 5. Verify signature with viem
    const valid = await verifyMessage({
      address: address as `0x${string}`,
      message,
      signature: signature as Hex,
    });
    if (!valid) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Invalid signature",
        status: 400,
        meta: { requestId },
      });
    }

    // 6. Link wallet (supports multiple wallets per user)
    const normalized = address.toLowerCase();

    // Upsert by address (handles case where address was linked to another user)
    await db.wallet.upsert({
      where: { address: normalized },
      update: { userId },
      create: { address: normalized, userId },
    });

    // 7. Update denormalized walletAddress to the most recently linked wallet
    await db.user.update({
      where: { id: userId },
      data: { walletAddress: normalized },
    });

    return okJson({ linked: true, address: normalized });
  },
  { auth: "onboarded" },
);
