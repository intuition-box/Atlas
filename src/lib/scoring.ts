import "server-only";

import { MembershipStatus, OrbitLevel } from "@prisma/client";

import { db } from "@/lib/db/client";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function arrayLen(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

const LOVE = {
  profileCompleteThreshold: 3,
  profileCompleteBonus: 2,
  approvedBonus: 3,
  attestationsGivenMax: 10,
  attestationGivenWeight: 1,
} as const;

const REACH = {
  // Unique peers you have reached (given attestations)
  uniqueToMax: 20,
  uniqueToWeight: 1,

  // Unique peers who have reached you (received attestations)
  uniqueFromMax: 20,
  uniqueFromWeight: 2,

  // Extra attestations beyond the first per peer (capped, to avoid spam dominating reach)
  extraToMax: 10,
  extraToWeight: 1,
  extraFromMax: 10,
  extraFromWeight: 1,
} as const;

function computeLove(params: {
  user: {
    headline: string | null;
    bio: string | null;
    links: unknown;
    skills: unknown;
    tags: unknown;
  };
  status: MembershipStatus;
  attestationsGivenCount: number;
}): number {
  const { user, status, attestationsGivenCount } = params;

  const profileCompleteness =
    (user.headline ? 1 : 0) +
    (user.bio ? 1 : 0) +
    (arrayLen(user.links) > 0 ? 1 : 0) +
    (arrayLen(user.skills) > 0 ? 1 : 0) +
    (arrayLen(user.tags) > 0 ? 1 : 0);

  const profileCompleteEnough = profileCompleteness >= LOVE.profileCompleteThreshold;

  let love = 0;
  if (profileCompleteEnough) love += LOVE.profileCompleteBonus;
  if (status === MembershipStatus.APPROVED) love += LOVE.approvedBonus;

  love +=
    clamp(attestationsGivenCount, 0, LOVE.attestationsGivenMax) *
    LOVE.attestationGivenWeight;

  return love;
}

function computeReach(params: {
  uniqueToCount: number;
  uniqueFromCount: number;
  extraToCount: number;
  extraFromCount: number;
}): number {
  return (
    clamp(params.uniqueToCount, 0, REACH.uniqueToMax) * REACH.uniqueToWeight +
    clamp(params.uniqueFromCount, 0, REACH.uniqueFromMax) * REACH.uniqueFromWeight +
    clamp(params.extraToCount, 0, REACH.extraToMax) * REACH.extraToWeight +
    clamp(params.extraFromCount, 0, REACH.extraFromMax) * REACH.extraFromWeight
  );
}

/**
 * Single-member recompute. Kept for convenience.
 * Internally delegates to the batch implementation.
 */
export async function recomputeMemberScores(params: { communityId: string; userId: string }) {
  await recomputeMemberScoresBatch({ communityId: params.communityId, userIds: [params.userId] });
}

/**
 * Batch recompute for many members.
 * - Uses Prisma groupBy for attestation counts (fewer round trips)
 * - Updates memberships in chunks to keep transactions reasonable
 */
export async function recomputeMemberScoresBatch(params: {
  communityId: string;
  userIds: string[];
}) {
  const communityId = params.communityId;
  const userIds = Array.from(new Set(params.userIds)).filter(Boolean);
  if (userIds.length === 0) return;

  const [users, memberships, givenCounts, receivedCounts, uniqueToPairs, uniqueFromPairs] = await Promise.all([
    db.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        headline: true,
        bio: true,
        links: true,
        skills: true,
        tags: true,
      },
    }),
    db.membership.findMany({
      where: { communityId, userId: { in: userIds } },
      select: { userId: true, status: true },
    }),

    // attestations given per user (active only)
    db.attestation.groupBy({
      by: ["fromUserId"],
      where: {
        communityId,
        fromUserId: { in: userIds },
        revokedAt: null,
        supersededById: null,
      },
      _count: { _all: true },
    }),

    // attestations received per user (active only)
    db.attestation.groupBy({
      by: ["toUserId"],
      where: {
        communityId,
        toUserId: { in: userIds },
        revokedAt: null,
        supersededById: null,
      },
      _count: { _all: true },
    }),

    // Distinct user pairs (dedup) to count unique peers.
    // We also separately count total attestations so multiple attestations can increase reach (capped).
    // distinct (fromUserId,toUserId) pairs => uniqueTo per fromUserId
    db.attestation.groupBy({
      by: ["fromUserId", "toUserId"],
      where: {
        communityId,
        fromUserId: { in: userIds },
        revokedAt: null,
        supersededById: null,
      },
    }),

    // distinct (toUserId,fromUserId) pairs => uniqueFrom per toUserId
    db.attestation.groupBy({
      by: ["toUserId", "fromUserId"],
      where: {
        communityId,
        toUserId: { in: userIds },
        revokedAt: null,
        supersededById: null,
      },
    }),
  ]);

  const userById = new Map(users.map((u) => [u.id, u] as const));
  const membershipByUserId = new Map(memberships.map((m) => [m.userId, m] as const));

  const givenByUserId = new Map<string, number>();
  for (const row of givenCounts) {
    // Prisma returns fromUserId nullable in types if schema allows; guard defensively.
    if (!row.fromUserId) continue;
    givenByUserId.set(row.fromUserId, row._count._all);
  }

  const receivedByUserId = new Map<string, number>();
  for (const row of receivedCounts) {
    if (!row.toUserId) continue;
    receivedByUserId.set(row.toUserId, row._count._all);
  }

  const uniqueToByFrom = new Map<string, number>();
  for (const row of uniqueToPairs) {
    if (!row.fromUserId) continue;
    uniqueToByFrom.set(row.fromUserId, (uniqueToByFrom.get(row.fromUserId) ?? 0) + 1);
  }

  const uniqueFromByTo = new Map<string, number>();
  for (const row of uniqueFromPairs) {
    if (!row.toUserId) continue;
    uniqueFromByTo.set(row.toUserId, (uniqueFromByTo.get(row.toUserId) ?? 0) + 1);
  }

  const updates = userIds
    .map((userId) => {
      const user = userById.get(userId);
      const membership = membershipByUserId.get(userId);
      if (!user || !membership) return null;

      const love = computeLove({
        user,
        status: membership.status,
        attestationsGivenCount: givenByUserId.get(userId) ?? 0,
      });

      const uniqueTo = uniqueToByFrom.get(userId) ?? 0;
      const uniqueFrom = uniqueFromByTo.get(userId) ?? 0;

      const givenTotal = givenByUserId.get(userId) ?? 0;
      const receivedTotal = receivedByUserId.get(userId) ?? 0;

      // Extra attestations beyond the first per unique peer.
      const extraTo = Math.max(0, givenTotal - uniqueTo);
      const extraFrom = Math.max(0, receivedTotal - uniqueFrom);

      const reach = computeReach({
        uniqueToCount: uniqueTo,
        uniqueFromCount: uniqueFrom,
        extraToCount: extraTo,
        extraFromCount: extraFrom,
      });

      const gravity = love * reach;

      return {
        userId,
        loveScore: love,
        reachScore: reach,
        gravityScore: gravity,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));

  if (updates.length === 0) return;

  // Avoid huge interactive transactions in dev; update in chunks.
  for (const batch of chunk(updates, 50)) {
    const ops = batch.map((u) =>
      db.membership.update({
        where: { userId_communityId: { userId: u.userId, communityId } },
        data: {
          loveScore: u.loveScore,
          reachScore: u.reachScore,
          gravityScore: u.gravityScore,
        },
        select: { id: true },
      }),
    );
    await db.$transaction(ops);
  }
}

export async function recomputeOrbitLevelsForCommunity(params: { communityId: string }) {
  const members = await db.membership.findMany({
    where: { communityId: params.communityId, status: MembershipStatus.APPROVED },
    select: { userId: true, gravityScore: true, orbitLevelOverride: true },
    orderBy: { gravityScore: "desc" },
  });

  if (members.length === 0) return;

  // Only bucket members without an override.
  const eligible = members.filter((m) => !m.orbitLevelOverride);
  if (eligible.length === 0) return;

  // Percentile buckets:
  // top 10% advocate, next 20% contributor, next 30% participant, rest explorer
  const total = eligible.length;
  const aCut = Math.ceil(total * 0.1);
  const cCut = Math.ceil(total * 0.3);
  const pCut = Math.ceil(total * 0.6);

  const advocates = eligible.slice(0, aCut).map((m) => m.userId);
  const contributors = eligible.slice(aCut, cCut).map((m) => m.userId);
  const participants = eligible.slice(cCut, pCut).map((m) => m.userId);
  const explorers = eligible.slice(pCut).map((m) => m.userId);

  const communityId = params.communityId;

  const ops = [
    { level: OrbitLevel.ADVOCATE, userIds: advocates },
    { level: OrbitLevel.CONTRIBUTOR, userIds: contributors },
    { level: OrbitLevel.PARTICIPANT, userIds: participants },
    { level: OrbitLevel.EXPLORER, userIds: explorers },
  ]
    .filter((x) => x.userIds.length > 0)
    .map((x) =>
      db.membership.updateMany({
        where: {
          communityId,
          status: MembershipStatus.APPROVED,
          orbitLevelOverride: null,
          userId: { in: x.userIds },
        },
        data: { orbitLevel: x.level },
      }),
    );

  await db.$transaction(ops);
}