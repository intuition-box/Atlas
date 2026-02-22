import {
  HandleOwnerType,
  HandleStatus,
  MembershipRole,
  MembershipStatus,
  OrbitLevel,
  Prisma,
} from "@prisma/client"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { errJson, okJson } from "@/lib/api/server"
import { requireAuth } from "@/lib/auth/policy"
import { db } from "@/lib/db/client"

export const runtime = "nodejs"

const ListMembershipQuerySchema = z
  .object({
    handle: z.string().trim().min(1, "Community handle is required"),

    // paging
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: z.string().trim().min(1).optional(),

    // sort
    sort: z.enum(["gravity", "love", "reach", "recent", "name"]).default("gravity"),

    // membership filters
    role: z.nativeEnum(MembershipRole).optional(),
    status: z.nativeEnum(MembershipStatus).optional().default(MembershipStatus.APPROVED),
    orbitLevel: z.nativeEnum(OrbitLevel).optional(),
    orbitLevelType: z.enum(["auto", "manual"]).optional(),

    // user profile filters
    q: z.string().trim().min(1).optional(),
    name: z.string().trim().min(1).optional(),
    headline: z.string().trim().min(1).optional(),
    bio: z.string().trim().min(1).optional(),
    location: z.string().trim().min(1).optional(),

    // multi-value filters (comma separated)
    skills: z.string().trim().optional(),
    tools: z.string().trim().optional(),
    links: z.string().trim().optional(),
    languages: z.string().trim().optional(),
  })
  .transform((v) => ({
    ...v,
    skills: v.skills
      ? v.skills
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
    tools: v.tools
      ? v.tools
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
    links: v.links
      ? v.links
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
    languages: v.languages
      ? v.languages
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [],
  }))

type Query = z.infer<typeof ListMembershipQuerySchema>

type MemberListItem = {
  membership: {
    id: string
    role: MembershipRole
    status: MembershipStatus
    orbitLevel: OrbitLevel | null
    orbitLevelOverride: OrbitLevel | null
    loveScore: number | null
    reachScore: number | null
    gravityScore: number | null
    approvedAt: string | null
    lastActiveAt: string | null
  }
  user: {
    id: string
    handle: string | null
    name: string | null
    image: string | null
    avatarUrl: string | null
    headline: string | null
    bio: string | null
    location: string | null
    skills: string[]
    tools: string[]
    links: string[]
    languages: string[]
  }
}

type ListMembershipOk = {
  items: MemberListItem[]
  nextCursor: string | null
}

function zodIssuesToApiIssues(error: z.ZodError): { path: string[]; message: string }[] {
  return error.issues.map((iss) => ({
    path: iss.path.map((seg) => String(seg)),
    message: iss.message,
  }))
}

async function resolveCommunityByHandle(handle: string) {
  const h = await db.handle.findUnique({
    where: { name: handle },
    select: {
      status: true,
      owner: { select: { ownerType: true, ownerId: true } },
    },
  })

  if (!h || h.status !== HandleStatus.ACTIVE || !h.owner || h.owner.ownerType !== HandleOwnerType.COMMUNITY) {
    return null
  }

  return db.community.findUnique({
    where: { id: h.owner.ownerId },
    select: { id: true, isPublicDirectory: true },
  })
}

export async function GET(req: NextRequest) {
  const raw = Object.fromEntries(req.nextUrl.searchParams.entries())

  const parsed = ListMembershipQuerySchema.safeParse(raw)
  if (!parsed.success) {
    return errJson({
      code: "INVALID_REQUEST",
      message: "Invalid request",
      status: 400,
      issues: zodIssuesToApiIssues(parsed.error),
    })
  }

  const q = parsed.data as unknown as Query

  const community = await resolveCommunityByHandle(q.handle)
  if (!community) {
    return errJson({ code: "NOT_FOUND", message: "Not found", status: 404 })
  }

  // Privacy gate:
  // - public directory: anyone can list
  // - private directory: only APPROVED members can list
  if (!community.isPublicDirectory) {
    let userId: string | null = null
    try {
      const auth = await requireAuth()
      userId = auth.userId
    } catch {
      userId = null
    }

    if (!userId) {
      // Don't leak private communities.
      return errJson({ code: "NOT_FOUND", message: "Not found", status: 404 })
    }

    const viewer = await db.membership.findUnique({
      where: { userId_communityId: { userId, communityId: community.id } },
      select: { status: true },
    })

    if (!viewer || viewer.status !== MembershipStatus.APPROVED) {
      return errJson({ code: "NOT_FOUND", message: "Not found", status: 404 })
    }
  }

  const where: Prisma.MembershipWhereInput = {
    communityId: community.id,
    ...(q.role ? { role: q.role } : null),
    ...(q.status ? { status: q.status } : null),
    ...(q.orbitLevel ? { orbitLevel: q.orbitLevel } : null),
    ...(q.orbitLevelType === "manual"
      ? { orbitLevelOverride: { not: null } }
      : q.orbitLevelType === "auto"
        ? { orbitLevelOverride: null }
        : null),
  }

  const userAnd: Prisma.UserWhereInput[] = []

  if (q.q) {
    userAnd.push({
      OR: [
        { name: { contains: q.q, mode: "insensitive" } },
        { headline: { contains: q.q, mode: "insensitive" } },
        { bio: { contains: q.q, mode: "insensitive" } },
      ],
    })
  }

  if (q.name) userAnd.push({ name: { contains: q.name, mode: "insensitive" } })
  if (q.headline) userAnd.push({ headline: { contains: q.headline, mode: "insensitive" } })
  if (q.bio) userAnd.push({ bio: { contains: q.bio, mode: "insensitive" } })
  if (q.location) userAnd.push({ location: { contains: q.location, mode: "insensitive" } })

  if (q.skills.length) userAnd.push({ skills: { hasSome: q.skills } })
  // UI “tools” maps to schema `tags`
  if (q.tools.length) userAnd.push({ tags: { hasSome: q.tools } })
  if (q.links.length) userAnd.push({ links: { hasSome: q.links } })
  if (q.languages.length) userAnd.push({ languages: { hasSome: q.languages } })

  let handleUserIds: string[] | null = null
  if (q.q) {
    const matches = await db.handle.findMany({
      where: {
        status: HandleStatus.ACTIVE,
        name: { contains: q.q, mode: "insensitive" },
        owner: { is: { ownerType: HandleOwnerType.USER } },
      },
      select: { owner: { select: { ownerId: true } } },
      take: 200,
    })

    handleUserIds = matches
      .map((h) => h.owner?.ownerId)
      .filter((id): id is string => typeof id === "string")
  }

  const orderBy: Prisma.MembershipOrderByWithRelationInput =
    q.sort === "recent"
      ? { lastActiveAt: "desc" }
      : q.sort === "love"
        ? { loveScore: "desc" }
        : q.sort === "reach"
          ? { reachScore: "desc" }
          : q.sort === "name"
            ? { user: { name: "asc" } }
            : { gravityScore: "desc" }

  const rows = await db.membership.findMany({
    where:
      q.q && handleUserIds && handleUserIds.length
        ? {
            OR: [
              {
                ...where,
                ...(userAnd.length ? { user: { AND: userAnd } } : null),
              },
              {
                ...where,
                userId: { in: handleUserIds },
                ...(userAnd.length ? { user: { AND: userAnd.filter((_) => true) } } : null),
              },
            ],
          }
        : {
            ...where,
            ...(userAnd.length ? { user: { AND: userAnd } } : null),
          },
    orderBy,
    take: q.limit + 1,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : null),
    select: {
      id: true,
      role: true,
      status: true,
      orbitLevel: true,
      orbitLevelOverride: true,
      loveScore: true,
      reachScore: true,
      gravityScore: true,
      approvedAt: true,
      lastActiveAt: true,
      user: {
        select: {
          id: true,
          name: true,
          image: true,
          avatarUrl: true,
          headline: true,
          bio: true,
          location: true,
          skills: true,
          tags: true,
          links: true,
          languages: true,
        },
      },
    },
  })

  const hasMore = rows.length > q.limit
  const slice = hasMore ? rows.slice(0, q.limit) : rows
  const nextCursor = hasMore ? slice[slice.length - 1]?.id ?? null : null

  const userIds = Array.from(new Set(slice.map((r) => r.user.id)))
  const userHandles = await db.handle.findMany({
    where: {
      status: HandleStatus.ACTIVE,
      owner: { is: { ownerType: HandleOwnerType.USER, ownerId: { in: userIds } } },
    },
    select: { name: true, owner: { select: { ownerId: true } } },
  })

  const handleByUserId = new Map<string, string>()
  for (const h of userHandles) {
    const id = h.owner?.ownerId
    if (id && !handleByUserId.has(id)) handleByUserId.set(id, h.name)
  }

  const payload: ListMembershipOk = {
    items: slice.map((r) => ({
      membership: {
        id: r.id,
        role: r.role,
        status: r.status,
        orbitLevel: r.orbitLevel ?? null,
        orbitLevelOverride: r.orbitLevelOverride ?? null,
        loveScore: r.loveScore ?? null,
        reachScore: r.reachScore ?? null,
        gravityScore: r.gravityScore ?? null,
        approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
        lastActiveAt: r.lastActiveAt ? r.lastActiveAt.toISOString() : null,
      },
      user: {
        id: r.user.id,
        handle: handleByUserId.get(r.user.id) ?? null,
        name: r.user.name ?? null,
        image: r.user.image ?? null,
        avatarUrl: r.user.avatarUrl ?? null,
        headline: r.user.headline ?? null,
        bio: r.user.bio ?? null,
        location: r.user.location ?? null,
        skills: Array.isArray(r.user.skills) ? r.user.skills : [],
        tools: Array.isArray(r.user.tags) ? r.user.tags : [],
        links: Array.isArray(r.user.links) ? r.user.links : [],
        languages: Array.isArray(r.user.languages) ? r.user.languages : [],
      },
    })),
    nextCursor,
  }

  return okJson<ListMembershipOk>(payload)
}
