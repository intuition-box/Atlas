import { HandleOwnerType, MembershipStatus } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { errJson, okJson } from "@/lib/api/server";
import { auth } from "@/lib/auth/session";
import { resolveHandleNamesForOwners } from "@/lib/handle-registry";

export const runtime = "nodejs";

const DEFAULT_TAKE = 24;
const MAX_TAKE = 200;

const QuerySchema = z.object({
  q: z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const s = v.trim();
      return s.length === 0 ? undefined : s;
    }, z.string().min(1).max(100))
    .optional(),

  take: z
    .preprocess((v) => {
      if (v === undefined || v === null) return undefined;
      if (typeof v === "string" && v.trim().length === 0) return undefined;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return v;
      const i = Math.floor(n);
      if (i < 1) return 1;
      if (i > MAX_TAKE) return MAX_TAKE;
      return i;
    }, z.number().int().min(1).max(MAX_TAKE))
    .optional(),

  cursor: z
    .preprocess((v) => {
      if (typeof v !== "string") return v;
      const s = v.trim();
      return s.length === 0 ? undefined : s;
    }, z.string().min(1))
    .optional(),
});

type CommunityListItem = {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  isPublicDirectory: boolean;
  isMembershipOpen: boolean;
  memberCount: number;
};

type CommunityListOk = {
  communities: CommunityListItem[];
  nextCursor: string | null;
};

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const parsed = QuerySchema.safeParse({
      q: url.searchParams.get("q") ?? undefined,
      take: url.searchParams.get("take") ?? undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });

    if (!parsed.success) {
      return errJson({
        code: "INVALID_REQUEST",
        message: "Invalid request",
        status: 400,
        issues: parsed.error.issues.map((iss) => ({
          path: iss.path.map((seg) => (typeof seg === "number" ? seg : String(seg))),
          message: iss.message,
        })),
      });
    }

    const { q, cursor } = parsed.data;
    const take = parsed.data.take ?? DEFAULT_TAKE;

    // Get viewer session to filter private communities
    const session = await auth();
    const viewerId = session?.user?.id ?? null;

    // Private communities are only visible to owners and approved members
    let viewerMemberCommunityIds: string[] = [];
    if (viewerId) {
      const viewerMemberships = await db.membership.findMany({
        where: { userId: viewerId, status: MembershipStatus.APPROVED },
        select: { communityId: true },
      });
      viewerMemberCommunityIds = viewerMemberships.map((m) => m.communityId);
    }

    const visibilityWhere = {
      OR: [
        { isPublicDirectory: true },
        ...(viewerId
          ? [
              { ownerId: viewerId },
              { id: { in: viewerMemberCommunityIds } },
            ]
          : []),
      ],
    };
    const searchWhere = q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { description: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : null;

    const where = searchWhere ? { AND: [visibilityWhere, searchWhere] } : visibilityWhere;

    // Stable pagination by createdAt desc + id desc.
    const rows = await db.community.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: take + 1,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      select: {
        id: true,
        name: true,
        description: true,
        avatarUrl: true,
        isPublicDirectory: true,
        isMembershipOpen: true,
        _count: { select: { memberships: true } },
      },
    });

    const page = rows.slice(0, take);
    const nextCursor = rows.length > take ? rows[take]!.id : null;

    if (page.length === 0) {
      return okJson<CommunityListOk>({ communities: [], nextCursor });
    }

    const handleByCommunityId = await resolveHandleNamesForOwners({
      ownerType: HandleOwnerType.COMMUNITY,
      ownerIds: page.map((c) => c.id),
    });

    // Only return rows with a valid handle mapping.
    const communities: CommunityListItem[] = page
      .map((c) => {
        const handle = handleByCommunityId.get(c.id);
        if (!handle) return null;
        return {
          id: c.id,
          handle,
          name: c.name,
          description: c.description,
          avatarUrl: c.avatarUrl,
          isPublicDirectory: c.isPublicDirectory,
          isMembershipOpen: c.isMembershipOpen,
          memberCount: c._count.memberships,
        };
      })
      .filter((c): c is CommunityListItem => Boolean(c));

    return okJson<CommunityListOk>({ communities, nextCursor });
  } catch (e) {
    return errJson({
      code: "INTERNAL_ERROR",
      message: "Something went wrong",
      status: 500,
    });
  }
}