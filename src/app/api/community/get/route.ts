import type { NextRequest } from "next/server";
import { HandleOwnerType, MembershipStatus } from "@prisma/client";

import { auth } from "@/lib/auth/session";
import { errJson, okJson } from "@/lib/api/server";
import { db } from "@/lib/db/client";
import {
  resolveCommunityIdFromHandle,
  resolveHandleNameForOwner,
} from "@/lib/handle-registry";
import { CommunityGetSchema } from "@/lib/validations";

export const runtime = "nodejs";

type CommunityGetOk = {
  mode: "full" | "splash";
  community: {
    id: string;
    handle: string;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    createdAt: string;
    isMembershipOpen: boolean;
    isPublicDirectory: boolean;
    membershipConfig: unknown | null;
    orbitConfig: unknown | null;
    discordUrl: string | null;
    xUrl: string | null;
    telegramUrl: string | null;
    githubUrl: string | null;
    websiteUrl: string | null;
  };
  memberCount: number;
  canViewDirectory: boolean;
  isAdmin: boolean;
  viewerMembership: {
    status: MembershipStatus;
    role: string;
  } | null;
  orbitMembers: Array<{
    id: string;
    handle: string | null;
    name: string | null;
    avatarUrl: string | null;
    image: string | null;
    orbitLevel: string;
    reachScore: number;
    headline: string | null;
    tags: string[] | null;
    lastActiveAt: Date | null;
    joinedAt: Date;
  }>;
};

export async function GET(req: NextRequest) {
  try {
    const parsed = CommunityGetSchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );

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

    const input = parsed.data;

    let communityId = input.communityId ?? null;

    if (!communityId && input.handle) {
      const resolved = await resolveCommunityIdFromHandle(input.handle);
      if (!resolved.ok) return errJson(resolved.error);
      communityId = resolved.value;
    }

    if (!communityId) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    const row = await db.community.findUnique({
      where: { id: communityId },
      select: {
        id: true,
        ownerId: true,
        name: true,
        description: true,
        avatarUrl: true,
        createdAt: true,
        isMembershipOpen: true,
        isPublicDirectory: true,
        membershipConfig: true,
        orbitConfig: true,
        discordUrl: true,
        xUrl: true,
        telegramUrl: true,
        githubUrl: true,
        websiteUrl: true,
        _count: {
          select: {
            memberships: { where: { status: MembershipStatus.APPROVED } },
          },
        },
      },
    });

    if (!row) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    const session = await auth();
    const userId = session?.user?.id ?? null;

    const isOwner = !!userId && row.ownerId === userId;

    const membership = userId
      ? await db.membership.findUnique({
          where: { userId_communityId: { userId, communityId } },
          select: { status: true, role: true },
        })
      : null;

    const viewerMembership = membership
      ? { status: membership.status, role: String(membership.role) }
      : null;

    const isApprovedMember = membership?.status === MembershipStatus.APPROVED;
    const canViewDirectory = row.isPublicDirectory || isApprovedMember || isOwner;

    // Privacy:
    // - Public directory: anyone can fetch.
    // - Private directory:
    //   - Approved members can fetch full data (and see members).
    //   - If membership is open, non-approved viewers get a minimal splash payload only.
    //   - Otherwise, return 404 to avoid leaking closed/private communities.
    const isPrivateAndNotApproved = !row.isPublicDirectory && !isApprovedMember && !isOwner;
    if (isPrivateAndNotApproved && !row.isMembershipOpen) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    const isAdmin = isOwner
      ? true
      : viewerMembership
          ? viewerMembership.role === "OWNER" || viewerMembership.role === "ADMIN"
          : false;

    const handleName = await resolveHandleNameForOwner(
      { ownerType: HandleOwnerType.COMMUNITY, ownerId: row.id },
      db,
    );

    if (!handleName) {
      return errJson({ code: "NOT_FOUND", message: "Community not found", status: 404 });
    }

    if (!canViewDirectory && !row.isPublicDirectory) {
      // Splash mode for private communities that are accepting applications.
      return okJson<CommunityGetOk>({
        mode: "splash",
        community: {
          id: row.id,
          handle: handleName,
          name: row.name,
          description: row.description,
          avatarUrl: row.avatarUrl,
          createdAt: row.createdAt.toISOString(),
          isMembershipOpen: row.isMembershipOpen,
          isPublicDirectory: row.isPublicDirectory,
          membershipConfig: null,
          orbitConfig: null,
          discordUrl: row.discordUrl,
          xUrl: row.xUrl,
          telegramUrl: row.telegramUrl,
          githubUrl: row.githubUrl,
          websiteUrl: row.websiteUrl,
        },
        memberCount: row._count.memberships,
        canViewDirectory: false,
        isAdmin: false,
        viewerMembership,
        orbitMembers: [],
      });
    }

    const orbitMembers: CommunityGetOk["orbitMembers"] = canViewDirectory
      ? await (async () => {
          const rows = await db.membership.findMany({
            where: { communityId, status: MembershipStatus.APPROVED },
            take: 800,
            orderBy: { gravityScore: "desc" },
            select: {
              userId: true,
              orbitLevel: true,
              reachScore: true,
              lastActiveAt: true,
              createdAt: true,
              user: {
                select: {
                  name: true,
                  avatarUrl: true,
                  image: true,
                  headline: true,
                  tags: true,
                },
              },
            },
          });

          const handlePairs = await Promise.all(
            rows.map(async (m) => {
              const h = await resolveHandleNameForOwner(
                { ownerType: HandleOwnerType.USER, ownerId: m.userId },
                db,
              );
              return [m.userId, h] as const;
            }),
          );

          const handles = new Map(handlePairs);

          return rows.map((m) => ({
            id: m.userId,
            handle: handles.get(m.userId) ?? null,
            name: m.user.name,
            avatarUrl: m.user.avatarUrl,
            image: m.user.image,
            orbitLevel: String(m.orbitLevel),
            reachScore: Number(m.reachScore ?? 0),
            headline: m.user.headline,
            tags: (m.user.tags as unknown as string[] | null) ?? null,
            lastActiveAt: m.lastActiveAt,
            joinedAt: m.createdAt,
          }));
        })()
      : [];

    return okJson<CommunityGetOk>({
      mode: "full",
      community: {
        id: row.id,
        handle: handleName,
        name: row.name,
        description: row.description,
        avatarUrl: row.avatarUrl,
        createdAt: row.createdAt.toISOString(),
        isMembershipOpen: row.isMembershipOpen,
        isPublicDirectory: row.isPublicDirectory,
        membershipConfig: (row.membershipConfig as unknown) ?? null,
        orbitConfig: (row.orbitConfig as unknown) ?? null,
        discordUrl: row.discordUrl,
        xUrl: row.xUrl,
        telegramUrl: row.telegramUrl,
        githubUrl: row.githubUrl,
        websiteUrl: row.websiteUrl,
      },
      memberCount: row._count.memberships,
      canViewDirectory,
      isAdmin,
      viewerMembership,
      orbitMembers,
    });
  } catch {
    return errJson({ code: "INTERNAL_ERROR", message: "Something went wrong", status: 500 });
  }
}
