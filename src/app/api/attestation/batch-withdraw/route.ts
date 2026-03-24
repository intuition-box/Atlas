import { EventType } from "@prisma/client";
import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { emitEvent, recomputeScoresForAttestationPair } from "@/lib/scoring";

export const runtime = "nodejs";

const ItemSchema = z.object({
  attestationId: z.string().trim().min(1),
  withdrawTxHash: z.string().trim().min(1),
});

const BodySchema = z.object({
  items: z.array(ItemSchema).min(1).max(100),
});

type BatchWithdrawOk = {
  withdrawn: Array<{
    id: string;
    withdrawTxHash: string;
  }>;
  skipped: string[];
};

/**
 * POST /api/attestation/batch-withdraw
 *
 * Persists onchain withdrawal results to the database.
 * Called after the client successfully redeems positions from the MultiVault.
 *
 * Flow:
 * 1. Client calls withdrawAttestations() → gets txHash
 * 2. Client calls this endpoint with the results
 * 3. We set revokedAt + withdrawTxHash for each attestation
 *
 * Only operates on minted attestations (must have mintedAt set).
 */
export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { items } = json;

  const attestationIds = items.map((i) => i.attestationId);

  // Fetch all attestations in one query
  const rows = await db.attestation.findMany({
    where: {
      id: { in: attestationIds },
      fromUserId: viewerId!, // Only author can withdraw
      mintedAt: { not: null }, // Must be minted
      revokedAt: null, // Not already revoked
    },
    select: {
      id: true,
      fromUserId: true,
      toUserId: true,
      type: true,
      source: true,
    },
  });

  if (rows.length === 0) {
    return errJson({
      code: "NOT_FOUND",
      message: "No valid minted attestations found to withdraw",
      status: 404,
    });
  }

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const withdrawn: BatchWithdrawOk["withdrawn"] = [];
  const skipped: string[] = [];

  // Use a transaction for consistency
  await db.$transaction(async (tx) => {
    for (const item of items) {
      const row = rowById.get(item.attestationId);

      // Not found or doesn't match criteria → skip
      if (!row) {
        skipped.push(item.attestationId);
        continue;
      }

      await tx.attestation.update({
        where: { id: item.attestationId },
        data: {
          revokedAt: new Date(),
          revokedByUserId: viewerId,
          withdrawTxHash: item.withdrawTxHash,
        },
        select: { id: true },
      });

      withdrawn.push({
        id: item.attestationId,
        withdrawTxHash: item.withdrawTxHash,
      });
    }
  });

  // Fire events and recompute scores outside the transaction
  for (const item of withdrawn) {
    const row = rowById.get(item.id);
    if (row) {
      emitEvent({
        fromUserId: row.fromUserId,
        toUserId: row.toUserId,
        type: EventType.ATTESTATION_RETRACTED,
        metadata: {
          attestationType: row.type,
          source: row.source ?? null,
          minted: true,
          withdrawn: true,
        },
      });
      recomputeScoresForAttestationPair({
        fromUserId: row.fromUserId,
        toUserId: row.toUserId,
      });
    }
  }

  return okJson<BatchWithdrawOk>({ withdrawn, skipped });
}, { auth: "onboarded" });
