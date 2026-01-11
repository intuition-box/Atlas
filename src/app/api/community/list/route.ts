import { HandleOwnerType, MembershipStatus } from "@prisma/client";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { db } from "@/lib/database";
import { auth } from "@/lib/auth";
import { errJson, okJson } from "@/lib/api-server";

export const runtime = "nodejs";

const QuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  take: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).optional(),
  includePrivate: z.coerce.boolean().optional(),
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
      includePrivate: url.searchParams.get("includePrivate") ?? undefined,
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
    const take = parsed.data.take ?? 24;

    const includePrivate = parsed.data.includePrivate ?? false;

    let userId: string | null = null;
    if (includePrivate) {
      const session = await auth();
      userId = session?.user?.id ?? null;

      if (!userId) {
        return errJson({
          code: "UNAUTHORIZED",
          message: "Sign in required",
          status: 401,
        });
      }
    }

    const visibilityWhere = includePrivate
      ? {
          OR: [
            { isPublicDirectory: true },
            {
              memberships: {
                some: {
                  userId: userId!,
                  status: { in: [MembershipStatus.APPROVED, MembershipStatus.PENDING] },
                },
              },
            },
          ],
        }
      : { isPublicDirectory: true };

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

    // Fetch canonical handles from HandleOwner mapping.
    const owners = await db.handleOwner.findMany({
      where: {
        ownerType: HandleOwnerType.COMMUNITY,
        ownerId: { in: page.map((c) => c.id) },
      },
      select: {
        ownerId: true,
        handle: { select: { name: true } },
      },
    });

    const handleByCommunityId = new Map<string, string>();
    for (const o of owners) handleByCommunityId.set(o.ownerId, o.handle.name);

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

// (Optional) You can add POST later if you want server-side filtering bodies, but per conventions we keep list as GET.