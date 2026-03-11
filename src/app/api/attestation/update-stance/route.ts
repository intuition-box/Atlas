import { z } from "zod";

import { api, okJson, errJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const BodySchema = z.object({
  attestationId: z.string().trim().min(1),
  stance: z.enum(["for", "against"]),
});

type UpdateStanceOk = {
  attestation: { id: string; stance: string };
};

export const POST = api(BodySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { attestationId, stance } = json;

  // Verify the attestation exists, belongs to viewer, and is unminted
  const attestation = await db.attestation.findUnique({
    where: { id: attestationId },
    select: { id: true, fromUserId: true, mintedAt: true, revokedAt: true },
  });

  if (!attestation) {
    return errJson({
      code: "NOT_FOUND",
      message: "Attestation not found",
      status: 404,
    });
  }

  if (attestation.fromUserId !== viewerId) {
    return errJson({
      code: "FORBIDDEN",
      message: "You can only update your own attestations",
      status: 403,
    });
  }

  if (attestation.mintedAt) {
    return errJson({
      code: "INVALID_REQUEST",
      message: "Cannot change stance on a minted attestation",
      status: 400,
    });
  }

  if (attestation.revokedAt) {
    return errJson({
      code: "INVALID_REQUEST",
      message: "Cannot change stance on a removed attestation",
      status: 400,
    });
  }

  const updated = await db.attestation.update({
    where: { id: attestationId },
    data: { stance },
    select: { id: true, stance: true },
  });

  return okJson<UpdateStanceOk>({
    attestation: { id: updated.id, stance: updated.stance ?? "for" },
  });
}, { auth: "auth" });
