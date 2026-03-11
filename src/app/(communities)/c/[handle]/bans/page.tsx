"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { apiGet, apiPost } from "@/lib/api/client"
import { communityPath, userPath } from "@/lib/routes"

import { ListFeed, ListFeedSkeleton } from "@/components/common/list-feed"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

import { hasPermission } from "@/lib/permissions-shared"
import { useCommunity } from "../community-provider"

// === TYPES ===

type MemberProfile = {
  id: string
  handle: string
  name?: string | null
  image?: string | null
}

type BannedMember = {
  membershipId: string
  role: string
  status: string
  updatedAt?: string | null
  bannedByHandle?: string | null
  user: MemberProfile
}

type ApiMemberItem = {
  membership: {
    id: string
    role: string
    status: string
    updatedAt?: string | null
    bannedByHandle?: string | null
  }
  user: {
    id: string
    handle: string | null
    name: string | null
    image: string | null
  }
}

// === HELPERS ===

function fmtDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function normalizeBannedPayload(raw: unknown): BannedMember[] {
  const r = raw as { items?: ApiMemberItem[] } | null
  const items = r?.items ?? []

  return items.map((item) => ({
    membershipId: item.membership.id,
    role: item.membership.role,
    status: item.membership.status,
    updatedAt: item.membership.updatedAt,
    bannedByHandle: item.membership.bannedByHandle,
    user: {
      id: item.user.id,
      handle: item.user.handle ?? "",
      name: item.user.name,
      image: item.user.image,
    },
  }))
}

// === SUB-COMPONENTS ===

function BannedMemberRow({
  member,
  onUnban,
  unbanning,
}: {
  member: BannedMember
  onUnban: (membershipId: string) => void
  unbanning: boolean
}) {
  const u = member.user
  const displayName = u.name?.trim() || `@${u.handle}`
  const href = userPath(u.handle)
  const bannedDate = member.updatedAt ? fmtDate(member.updatedAt) : null
  const bannedBy = member.bannedByHandle

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <Link href={href} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
        <ProfileAvatar type="user" src={u.image} name={displayName} size="sm" />
        <span className="truncate text-sm font-medium">{displayName}</span>
        <span className="truncate text-xs text-muted-foreground">@{u.handle}</span>
      </Link>
      <div className="flex items-center gap-3 shrink-0">
        <Badge variant="destructive" className="shrink-0">Banned</Badge>
        {(bannedBy || bannedDate) && (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {bannedBy && <>by <Link href={userPath(bannedBy)} className="text-primary hover:underline">@{bannedBy}</Link></>}
            {bannedBy && bannedDate && " "}
            {bannedDate && <>on {bannedDate}</>}
          </span>
        )}
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={unbanning}
          onClick={() => onUnban(member.membershipId)}
        >
          {unbanning ? "Unbanning\u2026" : "Unban"}
        </Button>
      </div>
    </div>
  )
}

// === MAIN COMPONENT ===

export default function CommunityBansPage() {
  const router = useRouter()
  const ctx = useCommunity()
  const handle = ctx.handle

  const [members, setMembers] = React.useState<BannedMember[]>([])
  const [loading, setLoading] = React.useState(true)
  const [unbanningId, setUnbanningId] = React.useState<string | null>(null)

  // Permission gate — redirect users without membership.remove permission
  const canManageBans = hasPermission(
    ctx.viewerMembership?.role ?? "MEMBER",
    "membership.remove",
    ctx.community?.permissions,
  )
  React.useEffect(() => {
    if (ctx.status === "ready" && !canManageBans) {
      router.replace(communityPath(handle))
    }
  }, [ctx.status, canManageBans, handle, router])

  // Fetch banned members once community data is ready
  React.useEffect(() => {
    if (ctx.status !== "ready" || !canManageBans) return

    const ac = new AbortController()

    void (async () => {
      const res = await apiGet<unknown>("/api/membership/list", {
        handle,
        status: "BANNED",
        limit: 100,
      }, { signal: ac.signal })

      if (ac.signal.aborted) return

      if (res.ok) {
        setMembers(normalizeBannedPayload(res.value))
      }
      setLoading(false)
    })()

    return () => { ac.abort() }
  }, [ctx.status, canManageBans, handle])

  async function handleUnban(membershipId: string) {
    setUnbanningId(membershipId)

    const result = await apiPost("/api/membership/status", {
      membershipId,
      status: "APPROVED",
    })

    setUnbanningId(null)

    if (result.ok) {
      setMembers((prev) => prev.filter((m) => m.membershipId !== membershipId))
    }
  }

  const isPageLoading = ctx.status === "loading" || loading

  if (isPageLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent>
          <ListFeedSkeleton rows={4} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Banned members</CardTitle>
        <CardDescription>Members who have been banned from this community.</CardDescription>
      </CardHeader>
      <CardContent>
        <ListFeed<BannedMember>
          items={members}
          keyExtractor={(m) => m.membershipId}
          renderItem={(m) => (
            <BannedMemberRow
              member={m}
              onUnban={handleUnban}
              unbanning={unbanningId === m.membershipId}
            />
          )}
          loading={false}
          emptyMessage="No banned members."
        />
      </CardContent>
    </Card>
  )
}
