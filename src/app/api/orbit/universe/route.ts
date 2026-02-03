import { HandleOwnerType, MembershipStatus, OrbitLevel } from "@prisma/client";
import type { NextRequest } from "next/server";

import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import { resolveHandleNamesForOwners } from "@/lib/handle-registry";

export const runtime = "nodejs";

type OrbitCommunity = {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  orbitStats: {
    advocates: number;
    contributors: number;
    participants: number;
    explorers: number;
    dominantLevel: "advocates" | "contributors" | "participants" | "explorers";
  };
};

type OrbitLink = {
  source: string;
  target: string;
  sharedMembers: number;
};

type OrbitUniverseOk = {
  communities: OrbitCommunity[];
  links: OrbitLink[];
};

/**
 * GET /api/orbit/universe
 *
 * Returns all data needed for the OrbitUniverse visualization:
 * - Public communities with their orbit level statistics
 * - Links between communities based on shared members
 */
export async function GET(_req: NextRequest) {
  try {
    // Fetch public communities
    const communityRows = await db.community.findMany({
      where: { isPublicDirectory: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        avatarUrl: true,
        isPublicDirectory: true,
        isMembershipOpen: true,
      },
    });

    if (communityRows.length === 0) {
      return okJson<OrbitUniverseOk>({ communities: [], links: [] });
    }

    // Resolve handles
    const handleByCommunityId = await resolveHandleNamesForOwners({
      ownerType: HandleOwnerType.COMMUNITY,
      ownerIds: communityRows.map((c) => c.id),
    });

    // Get all approved memberships for these communities
    const communityIds = communityRows.map((c) => c.id);
    const memberships = await db.membership.findMany({
      where: {
        status: MembershipStatus.APPROVED,
        communityId: { in: communityIds },
      },
      select: {
        userId: true,
        communityId: true,
        orbitLevel: true,
      },
    });

    // Build orbit stats and member counts per community
    type OrbitCounts = { advocates: number; contributors: number; participants: number; explorers: number };
    const orbitCounts = new Map<string, OrbitCounts>();
    const memberCounts = new Map<string, number>();

    // Track user communities for link calculation
    const userCommunities = new Map<string, string[]>();

    for (const m of memberships) {
      // Count members
      memberCounts.set(m.communityId, (memberCounts.get(m.communityId) ?? 0) + 1);

      // Track orbit levels
      let stats = orbitCounts.get(m.communityId);
      if (!stats) {
        stats = { advocates: 0, contributors: 0, participants: 0, explorers: 0 };
        orbitCounts.set(m.communityId, stats);
      }

      switch (m.orbitLevel) {
        case OrbitLevel.ADVOCATE:
          stats.advocates++;
          break;
        case OrbitLevel.CONTRIBUTOR:
          stats.contributors++;
          break;
        case OrbitLevel.PARTICIPANT:
          stats.participants++;
          break;
        case OrbitLevel.EXPLORER:
        default:
          stats.explorers++;
          break;
      }

      // Track user's communities for link calculation
      const list = userCommunities.get(m.userId);
      if (list) {
        list.push(m.communityId);
      } else {
        userCommunities.set(m.userId, [m.communityId]);
      }
    }

    // Build communities array
    const communities: OrbitCommunity[] = communityRows
      .map((c) => {
        const handle = handleByCommunityId.get(c.id);
        if (!handle) return null;

        const counts = orbitCounts.get(c.id) ?? { advocates: 0, contributors: 0, participants: 0, explorers: 0 };
        const { advocates, contributors, participants, explorers } = counts;

        // Determine dominant level
        let dominantLevel: OrbitCommunity["orbitStats"]["dominantLevel"] = "explorers";
        let maxCount = explorers;
        if (participants > maxCount) { dominantLevel = "participants"; maxCount = participants; }
        if (contributors > maxCount) { dominantLevel = "contributors"; maxCount = contributors; }
        if (advocates > maxCount) { dominantLevel = "advocates"; }

        return {
          id: c.id,
          handle,
          name: c.name,
          avatarUrl: c.avatarUrl,
          memberCount: memberCounts.get(c.id) ?? 0,
          isPublic: c.isPublicDirectory,
          isMembershipOpen: c.isMembershipOpen,
          orbitStats: { advocates, contributors, participants, explorers, dominantLevel },
        };
      })
      .filter((c): c is OrbitCommunity => c !== null);

    // Calculate links (shared members between communities)
    const linkCounts = new Map<string, number>();
    const communityIdSet = new Set(communityIds);

    for (const [, userCommunityIds] of userCommunities) {
      if (userCommunityIds.length < 2) continue;

      for (let i = 0; i < userCommunityIds.length; i++) {
        for (let j = i + 1; j < userCommunityIds.length; j++) {
          const a = userCommunityIds[i];
          const b = userCommunityIds[j];
          // Only include links for communities in our result set
          if (!communityIdSet.has(a) || !communityIdSet.has(b)) continue;

          const [source, target] = [a, b].sort();
          const key = `${source}|${target}`;
          linkCounts.set(key, (linkCounts.get(key) ?? 0) + 1);
        }
      }
    }

    const links: OrbitLink[] = [];
    for (const [key, count] of linkCounts) {
      const [source, target] = key.split("|");
      links.push({ source, target, sharedMembers: count });
    }
    links.sort((a, b) => b.sharedMembers - a.sharedMembers);

    return okJson<OrbitUniverseOk>({ communities, links });
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}
