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

type CheckAttestationsOk = {
  /** Array of attestation types the viewer has active for this user */
  activeTypes: string[];
  /** Detailed info about active attestations (including mint status) */
  activeAttestations: ActiveAttestation[];
};

/**
 * Check which attestation types the viewer already has for a target user.
 * Used by UI to show "already attested" state on buttons.
 * Also returns mintedAt to show onchain status.
 */
export const GET = api(QuerySchema, async (ctx) => {
  const { viewerId, json } = ctx;
  const { toUserId } = json;

  if (!viewerId) {
    return okJson<CheckAttestationsOk>({ activeTypes: [], activeAttestations: [] });
  }

  if (viewerId === toUserId) {
    return okJson<CheckAttestationsOk>({ activeTypes: [], activeAttestations: [] });
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

  return okJson<CheckAttestationsOk>({ activeTypes, activeAttestations });
}, { methods: ["GET"], auth: "public" });
