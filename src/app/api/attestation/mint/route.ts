import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const BodySchema = z.object({
  attestationId: z.string().trim().min(1),
  // These will be populated by the actual Intuition SDK call
  // For now they're optional to support the placeholder flow
  txHash: z.string().trim().min(1).optional(),
  onchainId: z.string().trim().min(1).optional(),
});

type MintOk = {
  attestation: {
    id: string;
    mintedAt: string;
    mintTxHash: string | null;
    onchainId: string | null;
  };
  alreadyMinted: boolean;
};

/**
 * POST /api/attestation/mint
 *
 * Marks an attestation as minted onchain.
 * This endpoint persists the mint state to the database.
 *
 * When Intuition integration is complete:
 * 1. Client calls Intuition SDK to mint
 * 2. On success, client calls this endpoint with txHash + onchainId
 * 3. We persist the state so future loads don't need to query blockchain
 */
export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { attestationId, txHash, onchainId } = json;

  const row = await db.attestation.findUnique({
    where: { id: attestationId },
    select: {
      id: true,
      fromUserId: true,
      mintedAt: true,
      mintTxHash: true,
      onchainId: true,
      revokedAt: true,
    },
  });

  if (!row) {
    return errJson({ code: "NOT_FOUND", message: "Attestation not found", status: 404 });
  }

  // Only the author can mint their own attestation
  if (row.fromUserId !== viewerId) {
    return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
  }

  // Can't mint revoked attestations
  if (row.revokedAt) {
    return errJson({
      code: "CONFLICT",
      message: "Cannot mint a revoked attestation",
      status: 409,
    });
  }

  // Already minted - return idempotently
  if (row.mintedAt) {
    return okJson<MintOk>({
      attestation: {
        id: row.id,
        mintedAt: row.mintedAt.toISOString(),
        mintTxHash: row.mintTxHash,
        onchainId: row.onchainId,
      },
      alreadyMinted: true,
    });
  }

  // Mark as minted
  const updated = await db.attestation.update({
    where: { id: row.id },
    data: {
      mintedAt: new Date(),
      mintTxHash: txHash ?? null,
      onchainId: onchainId ?? null,
    },
    select: {
      id: true,
      mintedAt: true,
      mintTxHash: true,
      onchainId: true,
    },
  });

  return okJson<MintOk>({
    attestation: {
      id: updated.id,
      mintedAt: updated.mintedAt!.toISOString(),
      mintTxHash: updated.mintTxHash,
      onchainId: updated.onchainId,
    },
    alreadyMinted: false,
  });
}, { auth: "onboarded" });
