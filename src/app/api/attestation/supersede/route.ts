import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const BodySchema = z.object({
  attestationId: z.string().trim().min(1),
  // New values to apply to the replacement attestation.
  // Semantics:
  // - undefined: keep existing
  // - null: clear
  // - value: set
  confidence: z.union([z.number().finite().min(0).max(1), z.null()]).optional(),
});

type SupersedeOk = {
  attestation: {
    id: string;
    supersedesId: string;
  };
};

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { attestationId, confidence } = json;

  if (confidence === undefined) {
    return errJson({
      code: "INVALID_REQUEST",
      message: "Nothing to change",
      status: 400,
    });
  }

  const existing = await db.attestation.findUnique({
    where: { id: attestationId },
    select: {
      id: true,
      fromUserId: true,
      toUserId: true,
      type: true,
      confidence: true,
      revokedAt: true,
      supersededById: true,
    },
  });

  if (!existing) {
    return errJson({ code: "NOT_FOUND", message: "Attestation not found", status: 404 });
  }

  if (existing.revokedAt) {
    return errJson({ code: "CONFLICT", message: "Attestation is revoked", status: 409 });
  }

  if (existing.supersededById) {
    return errJson({
      code: "CONFLICT",
      message: "Attestation is already superseded",
      status: 409,
    });
  }

  // Only the author can supersede their own attestation.
  if (existing.fromUserId !== viewerId) {
    return errJson({ code: "FORBIDDEN", message: "Not allowed", status: 403 });
  }

  const nextConfidence = confidence === null ? null : confidence;

  // If nothing changes, avoid creating a no-op replacement.
  if (nextConfidence === (existing.confidence ?? null)) {
    return errJson({
      code: "INVALID_REQUEST",
      message: "Nothing to change",
      status: 400,
    });
  }

  const created = await db.$transaction(async (tx) => {
    const replacement = await tx.attestation.create({
      data: {
        fromUserId: existing.fromUserId,
        toUserId: existing.toUserId,
        type: existing.type,
        confidence: nextConfidence,
      },
      select: { id: true },
    });

    await tx.attestation.update({
      where: { id: existing.id },
      data: { supersededById: replacement.id },
      select: { id: true },
    });

    return replacement;
  });

  return okJson<SupersedeOk>({
    attestation: { id: created.id, supersedesId: existing.id },
  });
}, { auth: "auth" });
