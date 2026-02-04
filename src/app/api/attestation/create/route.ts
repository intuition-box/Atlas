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
});

type CreateAttestationOk = {
  attestation: {
    id: string;
  };
};

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { toUserId, type } = json;

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

  // Create attestation (no constraints - user can attest multiple times)
  const attestation = await db.attestation.create({
    data: {
      fromUserId: viewerId!,
      toUserId,
      type,
    },
    select: { id: true },
  });

  return okJson<CreateAttestationOk>({ attestation: { id: attestation.id } });
}, { auth: "auth" });
