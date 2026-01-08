import "server-only";

import { MembershipStatus, OrbitLevel } from "@prisma/client";

import { db } from "@/lib/database";

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

const SCORE = {
  // Love
  profileCompleteThreshold: 3,
  profileCompleteBonus: 2,
  approvedBonus: 3,
  attestationsGivenMax: 10,
  attestationGivenWeight: 1,

  // Reach
  uniqueToMax: 20,
  uniqueFromMax: 20,
  uniqueToWeight: 1,
  uniqueFromWeight: 2,
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

  const profileCompleteEnough = profileCompleteness >= SCORE.profileCompleteThreshold;

  let love = 0;
  if (profileCompleteEnough) love += SCORE.profileCompleteBonus;
  if (status === MembershipStatus.APPROVED) love += SCORE.approvedBonus;

  love +=
    clamp(attestationsGivenCount, 0, SCORE.attestationsGivenMax) *
    SCORE.attestationGivenWeight;

  return love;
}

function computeReach(params: { uniqueToCount: number; uniqueFromCount: number }): number {
  return (
    clamp(params.uniqueToCount, 0, SCORE.uniqueToMax) * SCORE.uniqueToWeight +
    clamp(params.uniqueFromCount, 0, SCORE.uniqueFromMax) * SCORE.uniqueFromWeight
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

  const [users, memberships, givenCounts, uniqueToPairs, uniqueFromPairs] = await Promise.all([
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

    // attestations given per user
    db.attestation.groupBy({
      by: ["fromUserId"],
      where: { communityId, fromUserId: { in: userIds } },
      _count: { _all: true },
    }),

    // distinct (fromUserId,toUserId) pairs => uniqueTo per fromUserId
    db.attestation.groupBy({
      by: ["fromUserId", "toUserId"],
      where: { communityId, fromUserId: { in: userIds } },
    }),

    // distinct (toUserId,fromUserId) pairs => uniqueFrom per toUserId
    db.attestation.groupBy({
      by: ["toUserId", "fromUserId"],
      where: { communityId, toUserId: { in: userIds } },
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

      const reach = computeReach({
        uniqueToCount: uniqueToByFrom.get(userId) ?? 0,
        uniqueFromCount: uniqueFromByTo.get(userId) ?? 0,
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