import "server-only";

import { db } from "@/lib/db";
import { MembershipStatus, OrbitLevel } from "@prisma/client";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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

export async function recomputeMemberScores(params: {
  communityId: string;
  userId: string;
}) {
  const { communityId, userId } = params;

  const [user, membership] = await Promise.all([
    db.user.findUnique({
      where: { id: userId },
      select: {
        headline: true,
        bio: true,
        links: true,
        skills: true,
        tags: true,
      },
    }),
    db.membership.findUnique({
      where: { userId_communityId: { userId, communityId } },
      select: { status: true },
    }),
  ]);

  if (!user || !membership) return;

  // Love signals
  const profileCompleteness =
    (user.headline ? 1 : 0) +
    (user.bio ? 1 : 0) +
    (user.links.length > 0 ? 1 : 0) +
    (user.skills.length > 0 ? 1 : 0) +
    (user.tags.length > 0 ? 1 : 0);

  const profileCompleteEnough =
    profileCompleteness >= SCORE.profileCompleteThreshold;

  const attestationsGivenCount = await db.attestation.count({
    where: { communityId, fromUserId: userId },
  });

  let love = 0;
  if (profileCompleteEnough) love += SCORE.profileCompleteBonus;
  if (membership.status === MembershipStatus.APPROVED) love += SCORE.approvedBonus;

  love +=
    clamp(attestationsGivenCount, 0, SCORE.attestationsGivenMax) *
    SCORE.attestationGivenWeight;

  // Reach signals (proxy)
  const [uniqueTo, uniqueFrom] = await Promise.all([
    db.attestation.groupBy({
      by: ["toUserId"],
      where: { communityId, fromUserId: userId },
    }),
    db.attestation.groupBy({
      by: ["fromUserId"],
      where: { communityId, toUserId: userId },
    }),
  ]);

  const reach =
    clamp(uniqueTo.length, 0, SCORE.uniqueToMax) * SCORE.uniqueToWeight +
    clamp(uniqueFrom.length, 0, SCORE.uniqueFromMax) * SCORE.uniqueFromWeight;

  const gravity = love * reach;

  await db.membership.update({
    where: { userId_communityId: { userId, communityId } },
    data: {
      loveScore: love,
      reachScore: reach,
      gravityScore: gravity,
    },
    select: { id: true },
  });
}

export async function recomputeOrbitLevelsForCommunity(params: {
  communityId: string;
}) {
  const members = await db.membership.findMany({
    where: { communityId: params.communityId, status: MembershipStatus.APPROVED },
    select: { userId: true, gravityScore: true, orbitLevelOverride: true },
    orderBy: { gravityScore: "desc" },
  });

  if (members.length === 0) return;

  // Percentile buckets:
  // top 10% advocate, next 20% contributor, next 30% participant, rest explorer
  const total = members.length;
  const aCut = Math.ceil(total * 0.1);
  const cCut = Math.ceil(total * 0.3);
  const pCut = Math.ceil(total * 0.6);

  const advocates = members.slice(0, aCut).map((m) => m.userId);
  const contributors = members.slice(aCut, cCut).map((m) => m.userId);
  const participants = members.slice(cCut, pCut).map((m) => m.userId);
  const explorers = members.slice(pCut).map((m) => m.userId);

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
      })
    );

  await db.$transaction(ops);
}