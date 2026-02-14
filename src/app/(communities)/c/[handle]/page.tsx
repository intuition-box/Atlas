"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"
import {
  communityApplyPath,
  communityMembersPath,
  communitySettingsPath,
} from "@/lib/routes"

import { PageHeader } from "@/components/common/page-header"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

// === TYPES ===

type CommunityGetResponse = {
  mode: "full" | "splash"
  community: {
    id: string
    handle: string
    name: string
    description: string | null
    avatarUrl: string | null
    createdAt: string
    isMembershipOpen: boolean
    isPublicDirectory: boolean
  }
  memberCount: number
  canViewDirectory: boolean
  isAdmin: boolean
  viewerMembership: {
    status: string
    role: string
  } | null
  orbitMembers: Array<{
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
    image: string | null
    orbitLevel: string
    headline: string | null
  }>
}

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ready"; data: CommunityGetResponse }

// === HELPERS ===

function initials(name: string) {
  const s = name.trim()
  if (!s) return "?"
  const parts = s.split(/\s+/g).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase()
  }
  return s.slice(0, 2).toUpperCase()
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}

function roleLabel(role: string): string {
  switch (role) {
    case "OWNER": return "Owner"
    case "ADMIN": return "Admin"
    case "MOD": return "Moderator"
    case "MEMBER": return "Member"
    default: return role
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case "APPROVED": return "Active"
    case "PENDING": return "Pending"
    case "REJECTED": return "Rejected"
    case "BANNED": return "Banned"
    default: return status
  }
}

// === PAGE ===

export default function CommunityProfilePage() {
  const params = useParams<{ handle: string }>()
  const rawHandle = String(params?.handle ?? "")
  const handle = React.useMemo(() => normalizeHandle(rawHandle), [rawHandle])

  const [state, setState] = React.useState<LoadState>({ status: "idle" })

  React.useEffect(() => {
    const parsed = validateHandle(handle)
    if (!parsed.ok) {
      setState({ status: "not-found" })
      return
    }

    const controller = new AbortController()
    setState({ status: "loading" })

    void (async () => {
      const result = await apiGet<CommunityGetResponse>(
        "/api/community/get",
        { handle },
        { signal: controller.signal },
      )

      if (controller.signal.aborted) return

      if (result.ok) {
        setState({ status: "ready", data: result.value })
        return
      }

      if (result.error && typeof result.error === "object" && "status" in result.error) {
        const parsedErr = parseApiError(result.error)
        if (parsedErr.status === 404) {
          setState({ status: "not-found" })
          return
        }
        setState({ status: "error", message: parsedErr.formError || "Something went wrong." })
        return
      }

      const parsedErr = parseApiError(result.error)
      setState({ status: "error", message: parsedErr.formError || "Something went wrong." })
    })()

    return () => controller.abort()
  }, [handle])

  // --- SKELETON ---

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
        <Card>
          <CardContent className="flex items-center gap-4 px-5">
            <Skeleton className="size-12 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-28" />
            </div>
          </CardContent>
        </Card>

        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardContent className="flex flex-col gap-4 px-5">
              <div className="flex flex-col gap-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  // --- NOT FOUND ---

  if (state.status === "not-found") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
        <Alert>
          <AlertDescription>We couldn&apos;t find @{handle}.</AlertDescription>
        </Alert>
      </div>
    )
  }

  // --- ERROR ---

  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
        <Alert variant="destructive">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
        <div>
          <Button type="button" variant="secondary" onClick={() => setState({ status: "idle" })}>
            Retry
          </Button>
        </div>
      </div>
    )
  }

  if (state.status !== "ready") return null

  // --- READY ---

  const { community, memberCount, canViewDirectory, isAdmin, viewerMembership, orbitMembers } =
    state.data

  const handleLabel = community.handle ?? handle
  const avatarSrc = community.avatarUrl ?? ""
  const previewMembers = orbitMembers.slice(0, 5)

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pt-10 pb-40">
      <PageHeader
        leading={
          <Avatar className="h-12 w-12">
            <AvatarImage src={avatarSrc} alt={community.name} />
            <AvatarFallback>{initials(community.name)}</AvatarFallback>
          </Avatar>
        }
        title={community.name}
        description={`@${handleLabel}`}
        sticky={false}
        actions={
          <div className="flex items-center gap-2">
            {isAdmin ? (
              <Button type="button" variant="secondary">
                <Link href={communitySettingsPath(handleLabel)}>Settings</Link>
              </Button>
            ) : null}
            {!viewerMembership && community.isMembershipOpen ? (
              <Button type="button" variant="secondary">
                <Link href={communityApplyPath(handleLabel)}>Apply</Link>
              </Button>
            ) : null}
          </div>
        }
        actionsAsFormActions={false}
      />

      {/* About */}
      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <div className="flex flex-col gap-3">
            {/* Row 1: Created + Members */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Created</div>
                <div className="mt-1 text-sm text-foreground/80">{fmtDate(community.createdAt)}</div>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Members</div>
                <div className="mt-1 text-sm text-foreground/80">{memberCount}</div>
              </div>
            </div>

            {/* Row 2: Visibility + Membership */}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Visibility</div>
                <div className="mt-1">
                  <Badge variant="secondary">
                    {community.isPublicDirectory ? "Public" : "Private"}
                  </Badge>
                </div>
              </div>
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Membership</div>
                <div className="mt-1">
                  <Badge variant="secondary">
                    {community.isMembershipOpen ? "Open" : "Closed"}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Description */}
            {community.description ? (
              <div className="rounded-lg border border-border/60 p-3">
                <div className="text-xs font-medium text-foreground/70">Description</div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-foreground/80">
                  {community.description}
                </div>
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {/* Members preview */}
      {canViewDirectory && previewMembers.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <div className="flex flex-col gap-3">
              {previewMembers.map((m) => {
                const memberName = m.name?.trim() || m.handle || "Unknown"
                const memberAvatar = m.avatarUrl || m.image || ""

                return (
                  <div key={m.id} className="flex items-center gap-3">
                    <Avatar className="size-8">
                      <AvatarImage src={memberAvatar} alt={memberName} />
                      <AvatarFallback>{initials(memberName)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-foreground">{memberName}</div>
                      {m.handle ? (
                        <div className="truncate text-xs text-muted-foreground">@{m.handle}</div>
                      ) : null}
                    </div>
                    {m.headline ? (
                      <div className="hidden truncate text-xs text-muted-foreground sm:block">
                        {m.headline}
                      </div>
                    ) : null}
                  </div>
                )
              })}

              <Button type="button" variant="ghost" size="sm" className="w-fit">
                <Link href={communityMembersPath(handleLabel)}>
                  View all members →
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Viewer membership */}
      {viewerMembership ? (
        <Card>
          <CardHeader>
            <CardTitle>Your membership</CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <div className="flex items-center gap-3">
              <Badge variant="secondary">{roleLabel(viewerMembership.role)}</Badge>
              <Badge variant="outline">{statusLabel(viewerMembership.status)}</Badge>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
