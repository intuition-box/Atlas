import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const ItemSchema = z.object({
  attestationId: z.string().trim().min(1),
  txHash: z.string().trim().min(1),
  onchainId: z.string().trim().min(1).optional(),
});

const BodySchema = z.object({
  items: z.array(ItemSchema).min(1).max(100),
});

type BatchMintOk = {
  minted: Array<{
    id: string;
    mintedAt: string;
    mintTxHash: string;
    onchainId: string | null;
  }>;
  skipped: string[];
};

/**
 * POST /api/attestation/batch-mint
 *
 * Persists batch mint results to the database.
 * Called after the client successfully mints triples on-chain via the Intuition SDK.
 *
 * Flow:
 * 1. Client calls batchCreateAttestations() → gets txHash + onchainIds
 * 2. Client calls this endpoint with the results
 * 3. We persist mintedAt, mintTxHash, onchainId for each attestation
 *
 * Idempotent: already-minted items are returned in `skipped`.
 */
export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { items } = json;

  const attestationIds = items.map((i) => i.attestationId);

  // Fetch all attestations in one query
  const rows = await db.attestation.findMany({
    where: {
      id: { in: attestationIds },
      fromUserId: viewerId!, // Only author can mint (guaranteed by auth: 'onboarded')
      revokedAt: null, // Not revoked
    },
    select: {
      id: true,
      mintedAt: true,
    },
  });

  if (rows.length === 0) {
    return errJson({
      code: "NOT_FOUND",
      message: "No valid attestations found to mint",
      status: 404,
    });
  }

  const rowById = new Map(rows.map((r) => [r.id, r]));
  const minted: BatchMintOk["minted"] = [];
  const skipped: string[] = [];

  // Use a transaction for consistency
  await db.$transaction(async (tx) => {
    for (const item of items) {
      const row = rowById.get(item.attestationId);

      // Not found or already minted → skip
      if (!row || row.mintedAt) {
        skipped.push(item.attestationId);
        continue;
      }

      const updated = await tx.attestation.update({
        where: { id: item.attestationId },
        data: {
          mintedAt: new Date(),
          mintTxHash: item.txHash,
          onchainId: item.onchainId ?? null,
        },
        select: {
          id: true,
          mintedAt: true,
          mintTxHash: true,
          onchainId: true,
        },
      });

      minted.push({
        id: updated.id,
        mintedAt: updated.mintedAt!.toISOString(),
        mintTxHash: updated.mintTxHash!,
        onchainId: updated.onchainId,
      });
    }
  });

  return okJson<BatchMintOk>({ minted, skipped });
}, { auth: "onboarded" });
