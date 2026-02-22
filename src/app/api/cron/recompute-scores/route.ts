import { MembershipStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { db } from "@/lib/db/client";
import {
  recomputeMemberScoresBatch,
  recomputeOrbitLevelsForCommunity,
} from "@/lib/scoring";

export const runtime = "nodejs";

type CommunityResult = {
  communityId: string;
  memberCount: number;
  durationMs: number;
  error?: string;
};

export async function GET(req: NextRequest) {
  const headers = { "Cache-Control": "no-store" } as const;

  // Auth: verify Bearer token
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500, headers },
    );
  }

  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401, headers },
    );
  }

  // Dry run: default true outside production
  const dryRunParam = req.nextUrl.searchParams.get("dryRun");
  const dryRun =
    dryRunParam !== null
      ? dryRunParam !== "false"
      : process.env.NODE_ENV !== "production";

  // Find all communities with at least one approved member
  const communities = await db.community.findMany({
    where: {
      memberships: {
        some: { status: MembershipStatus.APPROVED },
      },
    },
    select: { id: true },
  });

  const results: CommunityResult[] = [];

  for (const community of communities) {
    const start = performance.now();

    try {
      // Fetch approved member IDs
      const memberships = await db.membership.findMany({
        where: {
          communityId: community.id,
          status: MembershipStatus.APPROVED,
        },
        select: { userId: true },
      });

      const userIds = memberships.map((m) => m.userId);

      if (!dryRun) {
        await recomputeMemberScoresBatch({
          communityId: community.id,
          userIds,
        });

        await recomputeOrbitLevelsForCommunity({
          communityId: community.id,
        });
      }

      results.push({
        communityId: community.id,
        memberCount: userIds.length,
        durationMs: Math.round(performance.now() - start),
      });
    } catch (e) {
      results.push({
        communityId: community.id,
        memberCount: 0,
        durationMs: Math.round(performance.now() - start),
        error: e instanceof Error ? e.message : "Unknown error",
      });
    }
  }

  const errors = results.filter((r) => r.error);

  return NextResponse.json(
    {
      ok: errors.length === 0,
      dryRun,
      totalCommunities: communities.length,
      totalErrors: errors.length,
      results,
    },
    { status: 200, headers },
  );
}
