import { EventType } from "@prisma/client";
import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { emitEvent, recomputeScoresForAttestationPair } from "@/lib/scoring";

export const runtime = "nodejs";

const BodySchema = z.object({
  attestationId: z.string().trim().min(1),
  reason: z.string().trim().min(1).max(200).optional(),
});

type RetractOk = {
  attestation: { id: string };
  alreadyRevoked: boolean;
};

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { attestationId, reason } = json;

  const row = await db.attestation.findUnique({
    where: { id: attestationId },
    select: {
      id: true,
      fromUserId: true,
      toUserId: true,
      type: true,
      source: true,
      mintedAt: true,
      revokedAt: true,
      supersededById: true,
    },
  });

  if (!row) {
    return errJson({ code: "NOT_FOUND", message: "Attestation not found", status: 404 });
  }

  if (row.revokedAt) {
    return okJson<RetractOk>({ attestation: { id: row.id }, alreadyRevoked: true });
  }

  if (row.supersededById) {
    return errJson({
      code: "CONFLICT",
      message: "Attestation can't be removed (superseded)",
      status: 409,
    });
  }

  // Only the author can retract their own attestation.
  if (row.fromUserId !== viewerId) {
    return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
  }

  await db.attestation.update({
    where: { id: row.id },
    data: {
      revokedAt: new Date(),
      revokedByUserId: viewerId,
      revokedReason: reason ?? null,
    },
    select: { id: true },
  });

  emitEvent({ fromUserId: row.fromUserId, toUserId: row.toUserId, type: EventType.ATTESTATION_RETRACTED, metadata: { attestationType: row.type, source: row.source ?? null, minted: !!row.mintedAt } });
  recomputeScoresForAttestationPair({ fromUserId: row.fromUserId, toUserId: row.toUserId });

  return okJson<RetractOk>({ attestation: { id: row.id }, alreadyRevoked: false });
}, { auth: "auth" });
