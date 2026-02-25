"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"

import { apiGet, apiPost } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import {
  ROUTES,
  userPath,
  communityPath,
  communityOrbitPath,
  communityApplicationsPath,
  communityBansPath,
  communitySettingsPath,
} from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

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

type CommunityInfo = {
  id: string
  handle: string
  name: string
  avatarUrl?: string | null
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

// === SKELETON ===

function BansSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <div className="w-full p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Skeleton className="size-12 rounded-full shrink-0" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-7 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-64 rounded-4xl" />
        </div>
      </div>

      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-3 min-w-0">
                <Skeleton className="size-8 rounded-full shrink-0" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <Skeleton className="h-4 w-32 hidden sm:block" />
                <Skeleton className="h-8 w-16 rounded-md" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
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
      <Link href={href} className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
        <ProfileAvatar type="user" src={u.image} name={displayName} className="h-8 w-8" />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{displayName}</div>
          <div className="truncate text-xs text-muted-foreground">@{u.handle}</div>
        </div>
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
  const params = useParams<{ handle: string }>()
  const handle = String(params?.handle || "")

  const [community, setCommunity] = React.useState<CommunityInfo | null>(null)
  const [members, setMembers] = React.useState<BannedMember[]>([])
  const [loading, setLoading] = React.useState(true)
  const [unbanningId, setUnbanningId] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!handle) return

    const ac = new AbortController()

    void (async () => {
      const res = await apiGet<unknown>("/api/membership/list", {
        handle,
        status: "BANNED",
        limit: 100,
      }, { signal: ac.signal })

      if (ac.signal.aborted) return

      if (!res.ok) {
        const parsed = parseApiError(res.error)
        if (parsed.status === 401) {
          router.replace(ROUTES.signIn)
          return
        }
        if (parsed.status === 403) {
          router.replace(communityPath(handle))
          return
        }
        setLoading(false)
        return
      }

      const raw = res.value as { community?: CommunityInfo; items?: ApiMemberItem[] }
      if (raw.community) {
        setCommunity(raw.community)
      }
      setMembers(normalizeBannedPayload(res.value))
      setLoading(false)
    })()

    return () => { ac.abort() }
  }, [handle, router])

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

  if (!handle) return null

  if (loading) {
    return <BansSkeleton />
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar
            type="community"
            src={community?.avatarUrl}
            name={community?.name || handle}
            className="h-12 w-12"
          />
        }
        title="Bans"
        description={`@${handle}`}
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            nav={[
              { label: "Orbit", href: communityOrbitPath(handle) },
              { label: "Profile", href: communityPath(handle) },
            ]}
            overflow={[
              { label: "Applications", href: communityApplicationsPath(handle) },
              { label: "Bans", href: communityBansPath(handle) },
              { label: "Settings", href: communitySettingsPath(handle) },
            ]}
          />
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Banned members</CardTitle>
          <CardDescription>Members who have been banned from this community.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {members.length > 0 ? (
            members.map((m) => (
              <BannedMemberRow
                key={m.membershipId}
                member={m}
                onUnban={handleUnban}
                unbanning={unbanningId === m.membershipId}
              />
            ))
          ) : (
            <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              No banned members.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
