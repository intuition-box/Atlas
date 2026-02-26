import "server-only";

import { MembershipRole, MembershipStatus, OrbitLevel, EventType, Prisma } from "@prisma/client";
import { z } from "zod";

import { db } from "@/lib/db/client";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// OrbitConfig — Zod-first, stored in Community.orbitConfig
// ---------------------------------------------------------------------------

const OrbitLevelThresholdSchema = z.object({
  minGravity: z.number().min(0),
  /** If set, the member must have given an attestation to a community peer within this many days. */
  recentAttestationDays: z.number().int().positive().nullable(),
});

export const OrbitConfigSchema = z.object({
  thresholds: z.object({
    ADVOCATE: OrbitLevelThresholdSchema,
    CONTRIBUTOR: OrbitLevelThresholdSchema,
    PARTICIPANT: OrbitLevelThresholdSchema,
  }),
  /** Half-life (in days) for the exponential decay applied to attestation activity. */
  decayHalfLifeDays: z.number().positive(),
  /** Only attestations within this window contribute to the activity (love) score. */
  activityWindowDays: z.number().int().positive(),
  /** Maximum activity score from attestation decay sum. */
  activityScoreCap: z.number().positive(),
});

export type OrbitConfig = z.infer<typeof OrbitConfigSchema>;

export const DEFAULT_ORBIT_CONFIG: OrbitConfig = {
  thresholds: {
    ADVOCATE: { minGravity: 200, recentAttestationDays: 30 },
    CONTRIBUTOR: { minGravity: 50, recentAttestationDays: 60 },
    PARTICIPANT: { minGravity: 10, recentAttestationDays: null },
  },
  decayHalfLifeDays: 30,
  activityWindowDays: 90,
  activityScoreCap: 10,
};

/** Parse raw JSON from Community.orbitConfig, falling back to defaults on any error. */
export function getOrbitConfig(raw: unknown): OrbitConfig {
  const result = OrbitConfigSchema.safeParse(raw);
  return result.success ? result.data : DEFAULT_ORBIT_CONFIG;
}

// ---------------------------------------------------------------------------
// Love — Activity-based with time decay
// ---------------------------------------------------------------------------

/**
 * Computes love score for a community member.
 *
 * - Profile bonus (0–3): `Math.floor(fieldCount * 3 / 5)`
 * - Approved bonus: +2 if membership status is APPROVED
 * - Activity score: exponential decay sum of community-scoped attestation
 *   activity within the activity window, capped at `activityScoreCap`.
 *
 * Love range: 0–15.
 */
export function computeLove(params: {
  user: {
    headline: string | null;
    bio: string | null;
    links: unknown;
    skills: unknown;
    tags: unknown;
  };
  status: MembershipStatus;
  /** Sorted descending attestation createdAt dates (community-scoped, within activity window). */
  attestationDates: Date[];
  config: OrbitConfig;
}): number {
  const { user, status, attestationDates, config } = params;

  // Profile bonus — up to 3 pts
  const fieldCount =
    (user.headline ? 1 : 0) +
    (user.bio ? 1 : 0) +
    (arrayLen(user.links) > 0 ? 1 : 0) +
    (arrayLen(user.skills) > 0 ? 1 : 0) +
    (arrayLen(user.tags) > 0 ? 1 : 0);
  const profileBonus = Math.floor((fieldCount * 3) / 5);

  // Approved bonus — 2 pts
  const approvedBonus = status === MembershipStatus.APPROVED ? 2 : 0;

  // Activity score — exponential decay sum, capped
  const now = Date.now();
  const ln2 = Math.LN2;
  const halfLifeMs = config.decayHalfLifeDays * 86_400_000;

  let decaySum = 0;
  for (const d of attestationDates) {
    const ageMs = now - d.getTime();
    decaySum += Math.exp((-ln2 * ageMs) / halfLifeMs);
  }

  const activityScore = Math.round(Math.min(decaySum, config.activityScoreCap));

  return profileBonus + approvedBonus + activityScore;
}

// ---------------------------------------------------------------------------
// Reach — Community-scoped + external dimension
// ---------------------------------------------------------------------------

const REACH = {
  /** Unique community members you attested (max 20, weight ×1). */
  uniqueGivenMax: 20,
  uniqueGivenWeight: 1,

  /** Unique community members who attested you (max 20, weight ×2). */
  uniqueReceivedMax: 20,
  uniqueReceivedWeight: 2,

  /** Extra attestations given beyond 1st per peer (max 10, weight ×1). */
  extraGivenMax: 10,
  extraGivenWeight: 1,

  /** Extra attestations received beyond 1st per peer (max 10, weight ×1). */
  extraReceivedMax: 10,
  extraReceivedWeight: 1,

  /** Other communities where the user is an approved member (max 5, weight ×2). */
  externalCommunitiesMax: 5,
  externalCommunitiesWeight: 2,
} as const;

/**
 * Computes reach score for a community member.
 *
 * Reach range: 0–90.
 */
export function computeReach(params: {
  uniqueGivenCount: number;
  uniqueReceivedCount: number;
  extraGivenCount: number;
  extraReceivedCount: number;
  externalCommunityCount: number;
}): number {
  return (
    clamp(params.uniqueGivenCount, 0, REACH.uniqueGivenMax) * REACH.uniqueGivenWeight +
    clamp(params.uniqueReceivedCount, 0, REACH.uniqueReceivedMax) * REACH.uniqueReceivedWeight +
    clamp(params.extraGivenCount, 0, REACH.extraGivenMax) * REACH.extraGivenWeight +
    clamp(params.extraReceivedCount, 0, REACH.extraReceivedMax) * REACH.extraReceivedWeight +
    clamp(params.externalCommunityCount, 0, REACH.externalCommunitiesMax) * REACH.externalCommunitiesWeight
  );
}

// ---------------------------------------------------------------------------
// Batch recompute — community-scoped
// ---------------------------------------------------------------------------

/**
 * Single-member recompute. Kept for convenience.
 * Internally delegates to the batch implementation.
 */
export async function recomputeMemberScores(params: { communityId: string; userId: string }) {
  await recomputeMemberScoresBatch({ communityId: params.communityId, userIds: [params.userId] });
}

/**
 * Batch recompute love, reach, and gravity for members of a community.
 *
 * All attestation queries are **community-scoped**: both the from-user and the
 * to-user must be approved members of this community. This aligns with the
 * Orbit Model's concept of community-specific engagement.
 */
export async function recomputeMemberScoresBatch(params: {
  communityId: string;
  userIds: string[];
}) {
  const { communityId } = params;
  const userIds = Array.from(new Set(params.userIds)).filter(Boolean);
  if (userIds.length === 0) return;

  // Load orbit config for this community
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { orbitConfig: true },
  });
  const config = getOrbitConfig(community?.orbitConfig);

  const activityWindowStart = new Date(
    Date.now() - config.activityWindowDays * 86_400_000,
  );

  // Fetch the set of all approved member IDs for this community (used to scope attestation queries).
  const approvedMemberships = await db.membership.findMany({
    where: { communityId, status: MembershipStatus.APPROVED },
    select: { userId: true },
  });
  const approvedMemberIds = new Set(approvedMemberships.map((m) => m.userId));
  const approvedMemberIdsArray = [...approvedMemberIds];

  const [
    users,
    memberships,
    givenAttestations,
    receivedAttestations,
    externalCounts,
  ] = await Promise.all([
    // 1. User profiles
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

    // 2. Membership statuses for target users
    db.membership.findMany({
      where: { communityId, userId: { in: userIds } },
      select: { userId: true, status: true },
    }),

    // 3. Active attestations GIVEN by target users TO community members
    //    (select fromUserId, toUserId, createdAt — filter activity window in JS for love)
    db.attestation.findMany({
      where: {
        fromUserId: { in: userIds },
        toUserId: { in: approvedMemberIdsArray },
        revokedAt: null,
        supersededById: null,
      },
      select: { fromUserId: true, toUserId: true, createdAt: true },
    }),

    // 4. Active attestations RECEIVED by target users FROM community members
    db.attestation.findMany({
      where: {
        toUserId: { in: userIds },
        fromUserId: { in: approvedMemberIdsArray },
        revokedAt: null,
        supersededById: null,
      },
      select: { fromUserId: true, toUserId: true, createdAt: true },
    }),

    // 5. External community count per user (approved memberships in other communities)
    db.membership.groupBy({
      by: ["userId"],
      where: {
        userId: { in: userIds },
        communityId: { not: communityId },
        status: MembershipStatus.APPROVED,
      },
      _count: { _all: true },
    }),
  ]);

  // Build lookup maps
  const userById = new Map(users.map((u) => [u.id, u] as const));
  const membershipByUserId = new Map(memberships.map((m) => [m.userId, m] as const));

  const externalCountByUserId = new Map<string, number>();
  for (const row of externalCounts) {
    externalCountByUserId.set(row.userId, row._count._all);
  }

  // Per-user attestation aggregation (single pass)
  // Given attestations: activity dates for love, unique peers + total for reach
  const givenDatesByUser = new Map<string, Date[]>();
  const givenUniquePeersByUser = new Map<string, Set<string>>();
  const givenTotalByUser = new Map<string, number>();

  for (const a of givenAttestations) {
    // Activity dates (for love — filter to activity window)
    if (a.createdAt >= activityWindowStart) {
      let dates = givenDatesByUser.get(a.fromUserId);
      if (!dates) {
        dates = [];
        givenDatesByUser.set(a.fromUserId, dates);
      }
      dates.push(a.createdAt);
    }

    // Unique peers given to
    let peers = givenUniquePeersByUser.get(a.fromUserId);
    if (!peers) {
      peers = new Set();
      givenUniquePeersByUser.set(a.fromUserId, peers);
    }
    peers.add(a.toUserId);

    // Total given
    givenTotalByUser.set(a.fromUserId, (givenTotalByUser.get(a.fromUserId) ?? 0) + 1);
  }

  // Received attestations: unique peers + total for reach
  const receivedUniquePeersByUser = new Map<string, Set<string>>();
  const receivedTotalByUser = new Map<string, number>();

  for (const a of receivedAttestations) {
    let peers = receivedUniquePeersByUser.get(a.toUserId);
    if (!peers) {
      peers = new Set();
      receivedUniquePeersByUser.set(a.toUserId, peers);
    }
    peers.add(a.fromUserId);

    receivedTotalByUser.set(a.toUserId, (receivedTotalByUser.get(a.toUserId) ?? 0) + 1);
  }

  // Compute scores
  const updates = userIds
    .map((userId) => {
      const user = userById.get(userId);
      const membership = membershipByUserId.get(userId);
      if (!user || !membership) return null;

      const love = computeLove({
        user,
        status: membership.status,
        attestationDates: givenDatesByUser.get(userId) ?? [],
        config,
      });

      const uniqueGiven = givenUniquePeersByUser.get(userId)?.size ?? 0;
      const uniqueReceived = receivedUniquePeersByUser.get(userId)?.size ?? 0;
      const totalGiven = givenTotalByUser.get(userId) ?? 0;
      const totalReceived = receivedTotalByUser.get(userId) ?? 0;

      const reach = computeReach({
        uniqueGivenCount: uniqueGiven,
        uniqueReceivedCount: uniqueReceived,
        extraGivenCount: Math.max(0, totalGiven - uniqueGiven),
        extraReceivedCount: Math.max(0, totalReceived - uniqueReceived),
        externalCommunityCount: externalCountByUserId.get(userId) ?? 0,
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

  // Write in chunks of 50 (existing pattern)
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

// ---------------------------------------------------------------------------
// Orbit levels — Absolute thresholds + behavioral gates
// ---------------------------------------------------------------------------

/**
 * Reassigns orbit levels for all approved members of a community based on
 * absolute gravity thresholds and behavioral gates (recency of attestation
 * activity), replacing the old percentile-based bucketing.
 *
 * Members with an `orbitLevelOverride` are skipped.
 */
export async function recomputeOrbitLevelsForCommunity(params: { communityId: string }) {
  const { communityId } = params;

  // Load config
  const community = await db.community.findUnique({
    where: { id: communityId },
    select: { orbitConfig: true },
  });
  const config = getOrbitConfig(community?.orbitConfig);

  // Fetch approved members (no override, skip owners — always Advocate)
  const members = await db.membership.findMany({
    where: {
      communityId,
      status: MembershipStatus.APPROVED,
      orbitLevelOverride: null,
      role: { not: MembershipRole.OWNER },
    },
    select: { userId: true, gravityScore: true },
  });

  if (members.length === 0) return;

  const memberUserIds = members.map((m) => m.userId);

  // Fetch all approved member IDs to scope attestation queries
  const approvedMemberships = await db.membership.findMany({
    where: { communityId, status: MembershipStatus.APPROVED },
    select: { userId: true },
  });
  const approvedMemberIds = [...new Set(approvedMemberships.map((m) => m.userId))];

  // Find the most recent attestation each eligible member gave to a community peer.
  // We fetch all active attestations from eligible members to community peers,
  // then pick the most recent per user in JS (avoids raw SQL).
  const recentAttestations = await db.attestation.findMany({
    where: {
      fromUserId: { in: memberUserIds },
      toUserId: { in: approvedMemberIds },
      revokedAt: null,
      supersededById: null,
    },
    select: { fromUserId: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  const lastAttestationByUser = new Map<string, Date>();
  for (const a of recentAttestations) {
    // Since ordered desc, the first occurrence per user is the most recent
    if (!lastAttestationByUser.has(a.fromUserId)) {
      lastAttestationByUser.set(a.fromUserId, a.createdAt);
    }
  }

  // Determine orbit level for each member
  const now = Date.now();
  const levels: Record<OrbitLevel, string[]> = {
    [OrbitLevel.ADVOCATE]: [],
    [OrbitLevel.CONTRIBUTOR]: [],
    [OrbitLevel.PARTICIPANT]: [],
    [OrbitLevel.EXPLORER]: [],
  };

  const orderedLevels: { level: OrbitLevel; threshold: z.infer<typeof OrbitLevelThresholdSchema> }[] = [
    { level: OrbitLevel.ADVOCATE, threshold: config.thresholds.ADVOCATE },
    { level: OrbitLevel.CONTRIBUTOR, threshold: config.thresholds.CONTRIBUTOR },
    { level: OrbitLevel.PARTICIPANT, threshold: config.thresholds.PARTICIPANT },
  ];

  for (const m of members) {
    let assigned: OrbitLevel = OrbitLevel.EXPLORER;

    for (const { level, threshold } of orderedLevels) {
      if (m.gravityScore < threshold.minGravity) continue;

      // Behavioral gate: if recentAttestationDays is set, check recency
      if (threshold.recentAttestationDays !== null) {
        const lastDate = lastAttestationByUser.get(m.userId);
        if (!lastDate) continue;

        const daysSince = (now - lastDate.getTime()) / 86_400_000;
        if (daysSince > threshold.recentAttestationDays) continue;
      }

      assigned = level;
      break; // Levels are checked top-down; first match wins
    }

    levels[assigned].push(m.userId);
  }

  // Batch update grouped by level
  const ops = Object.entries(levels)
    .filter(([, userIds]) => userIds.length > 0)
    .map(([level, userIds]) =>
      db.membership.updateMany({
        where: {
          communityId,
          status: MembershipStatus.APPROVED,
          orbitLevelOverride: null,
          userId: { in: userIds },
        },
        data: { orbitLevel: level as OrbitLevel },
      }),
    );

  if (ops.length > 0) {
    await db.$transaction(ops);
  }
}

// ---------------------------------------------------------------------------
// Event emitting — fire-and-forget
// ---------------------------------------------------------------------------

/**
 * Fire-and-forget: recompute love, reach, and gravity for both users in every
 * community where both are approved members. Called after attestation
 * create/retract so scores update immediately instead of waiting for the
 * daily cron.
 */
export function recomputeScoresForAttestationPair(params: {
  fromUserId: string;
  toUserId: string;
}) {
  const { fromUserId, toUserId } = params;

  db.membership
    .findMany({
      where: {
        userId: { in: [fromUserId, toUserId] },
        status: MembershipStatus.APPROVED,
      },
      select: { userId: true, communityId: true },
    })
    .then(async (memberships) => {
      const byCommunity = new Map<string, Set<string>>();
      for (const m of memberships) {
        let users = byCommunity.get(m.communityId);
        if (!users) {
          users = new Set();
          byCommunity.set(m.communityId, users);
        }
        users.add(m.userId);
      }

      for (const [communityId, users] of byCommunity) {
        if (users.has(fromUserId) && users.has(toUserId)) {
          await recomputeMemberScoresBatch({
            communityId,
            userIds: [fromUserId, toUserId],
          });
        }
      }
    })
    .catch(() => {
      // Best-effort; never block the caller's response.
    });
}

/**
 * Fire-and-forget: emit an Event for every community where both users are
 * approved members. Used by attestation create/retract routes.
 *
 * Never throws — failures are silently swallowed so they don't block the
 * calling route's response.
 */
export function emitEvent(params: {
  fromUserId: string;
  toUserId: string;
  type: EventType;
  metadata?: Prisma.InputJsonValue;
}) {
  const { fromUserId, toUserId, type, metadata } = params;

  db.membership
    .findMany({
      where: {
        userId: { in: [fromUserId, toUserId] },
        status: MembershipStatus.APPROVED,
      },
      select: { userId: true, communityId: true },
    })
    .then((memberships) => {
      // Group by community, keep only communities where BOTH users are approved
      const byCommunity = new Map<string, Set<string>>();
      for (const m of memberships) {
        let users = byCommunity.get(m.communityId);
        if (!users) {
          users = new Set();
          byCommunity.set(m.communityId, users);
        }
        users.add(m.userId);
      }

      const sharedCommunityIds: string[] = [];
      for (const [communityId, users] of byCommunity) {
        if (users.has(fromUserId) && users.has(toUserId)) {
          sharedCommunityIds.push(communityId);
        }
      }

      if (sharedCommunityIds.length === 0) return;

      return db.event.createMany({
        data: sharedCommunityIds.map((communityId) => ({
          communityId,
          actorId: fromUserId,
          subjectUserId: toUserId,
          type,
          ...(metadata ? { metadata } : {}),
        })),
      });
    })
    .catch(() => {
      // Best-effort; never block the caller's response.
    });
}
