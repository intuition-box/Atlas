import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { ATTESTATION_TYPES, type AttestationType } from "@/config/attestations";

export const runtime = "nodejs";

const attestationTypeValues = Object.keys(ATTESTATION_TYPES) as [AttestationType, ...AttestationType[]];

const BodySchema = z.object({
  // Always use userId; handle is for UI convenience only
  toUserId: z.string().trim().min(1),

  // Attestation type from config
  type: z.enum(attestationTypeValues),

  // Optional confidence value (0-1)
  confidence: z.number().min(0).max(1).optional(),
});

type CreateAttestationOk = {
  attestation: {
    id: string;
  };
  /** True if an existing attestation was found and returned (no new one created) */
  alreadyExists: boolean;
};

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { toUserId, type, confidence } = json;

  // Can't attest yourself
  if (toUserId === viewerId) {
    return errJson({
      code: "INVALID_REQUEST",
      message: "You can't attest yourself",
      status: 400,
    });
  }

  // Verify target user exists
  const targetUser = await db.user.findUnique({
    where: { id: toUserId },
    select: { id: true },
  });

  if (!targetUser) {
    return errJson({
      code: "NOT_FOUND",
      message: "User not found",
      status: 404,
    });
  }

  // Check for existing active attestation of the same type
  const existing = await db.attestation.findFirst({
    where: {
      fromUserId: viewerId!,
      toUserId,
      type,
      revokedAt: null,
      supersededById: null,
    },
    select: { id: true, confidence: true },
  });

  // If already exists with same confidence, return idempotently
  if (existing) {
    const existingConfidence = existing.confidence ?? undefined;
    if (existingConfidence === confidence) {
      return okJson<CreateAttestationOk>({
        attestation: { id: existing.id },
        alreadyExists: true,
      });
    }

    // If confidence differs, supersede the existing attestation
    const created = await db.$transaction(async (tx) => {
      const replacement = await tx.attestation.create({
        data: {
          fromUserId: viewerId!,
          toUserId,
          type,
          confidence: confidence ?? null,
        },
        select: { id: true },
      });

      await tx.attestation.update({
        where: { id: existing.id },
        data: { supersededById: replacement.id },
      });

      return replacement;
    });

    return okJson<CreateAttestationOk>({
      attestation: { id: created.id },
      alreadyExists: false,
    });
  }

  // Create new attestation
  const attestation = await db.attestation.create({
    data: {
      fromUserId: viewerId!,
      toUserId,
      type,
      confidence: confidence ?? null,
    },
    select: { id: true },
  });

  return okJson<CreateAttestationOk>({
    attestation: { id: attestation.id },
    alreadyExists: false,
  });
}, { auth: "auth" });
