import { HandleOwnerType } from "@prisma/client";
import { z } from "zod";

import { api, okJson } from "@/lib/api/server";
import { auth } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { resolveHandleNameForOwner } from "@/lib/handle-registry";

export const runtime = "nodejs";

const QuerySchema = z.object({
  toUserId: z.string().trim().min(1),
});

/** Max attestors returned per type in the tooltip list */
const MAX_ATTESTORS_PER_TYPE = 10;

type ActiveAttestation = {
  type: string;
  mintedAt: string | null;
};

type AttestorInfo = {
  id: string;
  name: string | null;
  handle: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

type AttestationStatusOk = {
  /** Array of attestation types the viewer has active for this user */
  activeTypes: string[];
  /** Detailed info about active attestations (including mint status) */
  activeAttestations: ActiveAttestation[];
  /** Count of attestations received per type (from all users, not just viewer) */
  receivedCountsByType: Record<string, number>;
  /** Attestor details per type (capped at MAX_ATTESTORS_PER_TYPE) */
  receivedUsersByType: Record<string, AttestorInfo[]>;
  /** Endorsement counts per attributeId (from all users) */
  endorsementCountsByAttribute: Record<string, number>;
  /** Endorser details per attributeId (capped at MAX_ATTESTORS_PER_TYPE) */
  endorsementUsersByAttribute: Record<string, AttestorInfo[]>;
  /** Array of attributeIds the viewer has endorsed for this user */
  viewerEndorsedAttributes: string[];
};

/**
 * GET /api/attestation/status
 *
 * Lightweight endpoint to check attestation status between viewer and target user.
 * Returns which attestation types exist and their onchain status.
 * Used by AttestationButtons to show "already attested" / "onchain" state.
 */
export const GET = api(QuerySchema, async (ctx) => {
  const { json } = ctx;
  const { toUserId } = json;

  // Optionally resolve viewer session (endpoint is public, but we need
  // viewerId when logged in to return active/endorsed state).
  let viewerId: string | null = ctx.viewerId;
  if (!viewerId) {
    try {
      const session = await auth();
      viewerId = session?.user?.id ?? null;
    } catch {
      viewerId = null;
    }
  }

  // Fetch all received attestations with attestor info (public data)
  const [receivedRows, viewerRows] = await Promise.all([
    db.attestation.findMany({
      where: {
        toUserId,
        revokedAt: null,
        supersededById: null,
      },
      select: {
        type: true,
        attributeId: true,
        createdAt: true,
        fromUser: { select: { id: true, name: true, image: true, avatarUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    // Viewer's own attestations to this user (for active status)
    viewerId && viewerId !== toUserId
      ? db.attestation.findMany({
          where: {
            fromUserId: viewerId,
            toUserId,
            revokedAt: null,
            supersededById: null,
          },
          select: { type: true, attributeId: true, mintedAt: true },
        })
      : Promise.resolve([]),
  ]);

  // Derive counts and user lists from received rows
  const receivedCountsByType: Record<string, number> = {};
  const receivedUsersByType: Record<string, AttestorInfo[]> = {};
  const seenByType = new Map<string, Set<string>>();

  // Endorsement-specific aggregations (keyed by attributeId)
  const endorsementCountsByAttribute: Record<string, number> = {};
  const endorsementUsersByAttribute: Record<string, AttestorInfo[]> = {};
  const seenByAttribute = new Map<string, Set<string>>();

  // Collect unique user IDs for handle resolution
  const userIds = new Set<string>();

  for (const row of receivedRows) {
    const { type, attributeId } = row;

    // Process endorsement attestations into per-attribute aggregations
    if ((type === "SKILL_ENDORSE" || type === "TOOL_ENDORSE") && attributeId) {
      endorsementCountsByAttribute[attributeId] = (endorsementCountsByAttribute[attributeId] ?? 0) + 1;

      if (!seenByAttribute.has(attributeId)) seenByAttribute.set(attributeId, new Set());
      const seen = seenByAttribute.get(attributeId)!;

      if (!seen.has(row.fromUser.id) && seen.size < MAX_ATTESTORS_PER_TYPE) {
        seen.add(row.fromUser.id);
        userIds.add(row.fromUser.id);

        if (!endorsementUsersByAttribute[attributeId]) endorsementUsersByAttribute[attributeId] = [];
        endorsementUsersByAttribute[attributeId].push({
          id: row.fromUser.id,
          name: row.fromUser.name,
          handle: null,
          avatarUrl: row.fromUser.avatarUrl ?? row.fromUser.image,
          createdAt: row.createdAt.toISOString(),
        });
      }
      continue; // Don't count endorsements in the per-type aggregation
    }

    receivedCountsByType[type] = (receivedCountsByType[type] ?? 0) + 1;

    // Track unique users per type (cap at MAX_ATTESTORS_PER_TYPE)
    if (!seenByType.has(type)) seenByType.set(type, new Set());
    const seen = seenByType.get(type)!;

    if (!seen.has(row.fromUser.id) && seen.size < MAX_ATTESTORS_PER_TYPE) {
      seen.add(row.fromUser.id);
      userIds.add(row.fromUser.id);

      if (!receivedUsersByType[type]) receivedUsersByType[type] = [];
      receivedUsersByType[type].push({
        id: row.fromUser.id,
        name: row.fromUser.name,
        handle: null, // resolved below
        avatarUrl: row.fromUser.avatarUrl ?? row.fromUser.image,
        createdAt: row.createdAt.toISOString(),
      });
    }
  }

  // Batch-resolve handles for all attestor users
  const handlePairs = await Promise.all(
    Array.from(userIds).map(async (id) => {
      const h = await resolveHandleNameForOwner({ ownerType: HandleOwnerType.USER, ownerId: id });
      return [id, h] as const;
    }),
  );
  const handleMap = new Map(handlePairs);

  // Patch handles into the user lists
  for (const users of Object.values(receivedUsersByType)) {
    for (const u of users) {
      u.handle = handleMap.get(u.id) ?? null;
    }
  }
  for (const users of Object.values(endorsementUsersByAttribute)) {
    for (const u of users) {
      u.handle = handleMap.get(u.id) ?? null;
    }
  }

  // No viewer or self — return counts + users only
  if (!viewerId || viewerId === toUserId) {
    return okJson<AttestationStatusOk>({
      activeTypes: [],
      activeAttestations: [],
      receivedCountsByType,
      receivedUsersByType,
      endorsementCountsByAttribute,
      endorsementUsersByAttribute,
      viewerEndorsedAttributes: [],
    });
  }

  const isEndorsement = (t: string) => t === "SKILL_ENDORSE" || t === "TOOL_ENDORSE";
  const activeTypes = viewerRows.filter((r) => !isEndorsement(r.type)).map((r) => r.type);
  const activeAttestations = viewerRows
    .filter((r) => !isEndorsement(r.type))
    .map((r) => ({
      type: r.type,
      mintedAt: "mintedAt" in r && r.mintedAt ? (r.mintedAt as Date).toISOString() : null,
    }));
  const viewerEndorsedAttributes = viewerRows
    .filter((r) => isEndorsement(r.type) && r.attributeId)
    .map((r) => r.attributeId!);

  return okJson<AttestationStatusOk>({
    activeTypes,
    activeAttestations,
    receivedCountsByType,
    receivedUsersByType,
    endorsementCountsByAttribute,
    endorsementUsersByAttribute,
    viewerEndorsedAttributes,
  });
}, { methods: ["GET"], auth: "public" });
