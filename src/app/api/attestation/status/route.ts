import { z } from "zod";

import { api, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";

export const runtime = "nodejs";

const QuerySchema = z.object({
  toUserId: z.string().trim().min(1),
});

type ActiveAttestation = {
  type: string;
  mintedAt: string | null;
};

type AttestationStatusOk = {
  /** Array of attestation types the viewer has active for this user */
  activeTypes: string[];
  /** Detailed info about active attestations (including mint status) */
  activeAttestations: ActiveAttestation[];
};

/**
 * GET /api/attestation/status
 *
 * Lightweight endpoint to check attestation status between viewer and target user.
 * Returns which attestation types exist and their onchain status.
 * Used by AttestationButtons to show "already attested" / "onchain" state.
 */
export const GET = api(QuerySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { toUserId } = json;

  if (!viewerId) {
    return okJson<AttestationStatusOk>({ activeTypes: [], activeAttestations: [] });
  }

  if (viewerId === toUserId) {
    return okJson<AttestationStatusOk>({ activeTypes: [], activeAttestations: [] });
  }

  const rows = await db.attestation.findMany({
    where: {
      fromUserId: viewerId,
      toUserId,
      revokedAt: null,
      supersededById: null,
    },
    select: {
      type: true,
      mintedAt: true,
    },
  });

  const activeTypes = rows.map((r) => r.type);
  const activeAttestations = rows.map((r) => ({
    type: r.type,
    mintedAt: r.mintedAt?.toISOString() ?? null,
  }));

  return okJson<AttestationStatusOk>({ activeTypes, activeAttestations });
}, { methods: ["GET"], auth: "auth" });
