"use client"

import * as React from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { useSession } from "next-auth/react"

import { ArrowUpRight } from "lucide-react"

import { apiGet } from "@/lib/api/client"
import { parseApiError } from "@/lib/api/errors"
import { normalizeHandle, validateHandle } from "@/lib/handle"
import {
  communityPath,
  communityActivityPath,
  communityMembersPath,
  communityOrbitPath,
  communityApplicationsPath,
  communityBansPath,
  communityPermissionsPath,
  communitySettingsPath,
  userPath,
} from "@/lib/routes"
import { ATTESTATION_TYPES, type AttestationType } from "@/lib/attestations/definitions"
import { AttestationBadge } from "@/components/attestation/badge"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

// === TYPES ===

type ActivityUser = {
  id: string
  handle: string | null
  name: string | null
  avatarUrl: string | null
}

type CommunityActivityEvent = {
  id: string
  type: string
  createdAt: string
  actor: ActivityUser
  subject: ActivityUser | null
  metadata: Record<string, unknown> | null
}

type ActivityResponse = {
  events: CommunityActivityEvent[]
  nextCursor: string | null
}

type CommunityGetResponse = {
  community: {
    id: string
    name: string
    avatarUrl: string | null
    isPublicDirectory: boolean
  }
  isAdmin: boolean
  canViewDirectory: boolean
}

type FilterState = {
  q: string
  type: string
}

const EMPTY_FILTERS: FilterState = { q: "", type: "" }

// === EVENT TYPE CONFIG ===

const EVENT_TYPE_CONFIG: Record<string, { label: string; variant: "default" | "positive" | "info" | "destructive" | "secondary" }> = {
  JOINED: { label: "Joined", variant: "positive" },
  ATTESTED: { label: "Attestation", variant: "default" },
  ATTESTATION_RETRACTED: { label: "Retracted", variant: "destructive" },
  ATTESTATION_SUPERSEDED: { label: "Attestation Updated", variant: "secondary" },
  ROLE_UPDATED: { label: "Role Change", variant: "info" },
  ORBIT_OVERRIDE: { label: "Orbit Override", variant: "info" },
}

const EVENT_TYPE_LIST = Object.entries(EVENT_TYPE_CONFIG) as Array<
  [string, { label: string; variant: string }]
>

// === HOOKS ===

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])

  return debounced
}

function useActivityFeed(handle: string, filters: FilterState) {
  const [events, setEvents] = React.useState<CommunityActivityEvent[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)

  const filtersKey = JSON.stringify(filters)

  const load = React.useCallback(async (cursor?: string) => {
    const isInitial = !cursor
    if (isInitial) setLoading(true)
    else setLoadingMore(true)

    const params: Record<string, string> = { handle, take: "50" }
    if (cursor) params.cursor = cursor
    if (filters.type) params.type = filters.type

    const res = await apiGet<ActivityResponse>("/api/community/activity/list", params)

    if (res.ok) {
      setEvents((prev) => isInitial ? res.value.events : [...prev, ...res.value.events])
      setNextCursor(res.value.nextCursor)
    }

    setLoading(false)
    setLoadingMore(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, filtersKey])

  React.useEffect(() => {
    setEvents([])
    setNextCursor(null)
    void load()
  }, [load])

  const loadMore = React.useCallback(() => {
    if (nextCursor && !loadingMore) void load(nextCursor)
  }, [nextCursor, loadingMore, load])

  return { events, loading, loadingMore, hasMore: !!nextCursor, loadMore }
}

// === UTILITIES ===

function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ""

  const diff = Date.now() - ts
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (days > 30) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: days > 365 ? "numeric" : undefined,
    })
  }
  if (days > 0) return `${days}d ago`
  if (hours > 0) return `${hours}h ago`
  if (minutes > 0) return `${minutes}m ago`
  return "just now"
}

function displayName(user: ActivityUser): string {
  return user.name?.trim() || (user.handle ? `@${user.handle}` : "Unknown")
}

function hasActiveFilters(filters: FilterState): boolean {
  return Boolean(filters.q || filters.type)
}

// === SUB-COMPONENTS ===

function UserLink({ user }: { user: ActivityUser }) {
  const name = displayName(user)
  const href = user.handle ? userPath(user.handle) : "#"

  return (
    <Link href={href} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
      <ProfileAvatar type="user" src={user.avatarUrl} name={name} size="sm" />
      <span className="truncate text-sm font-medium">{name}</span>
    </Link>
  )
}

function EventTypeBadge({ type }: { type: string }) {
  const config = EVENT_TYPE_CONFIG[type]
  if (!config) return <Badge variant="secondary">{type}</Badge>
  return <Badge variant={config.variant} className="shrink-0">{config.label}</Badge>
}

// === EVENT CARDS ===

function JoinedEventCard({ event }: { event: CommunityActivityEvent }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.actor} />
        <span className="text-muted-foreground shrink-0">joined the community</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <EventTypeBadge type={event.type} />
        <span className="text-xs text-muted-foreground">{formatRelativeTime(event.createdAt)}</span>
      </div>
    </div>
  )
}

function AttestationEventCard({ event }: { event: CommunityActivityEvent }) {
  const attestationType = (event.metadata?.attestationType as string) ?? null

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.actor} />
        <ArrowUpRight className="size-3 shrink-0 text-amber-500" />
        {event.subject ? (
          <UserLink user={event.subject} />
        ) : (
          <span className="text-muted-foreground">unknown</span>
        )}
        {attestationType && attestationType in ATTESTATION_TYPES && (
          <AttestationBadge type={attestationType as AttestationType} />
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <EventTypeBadge type={event.type} />
        <span className="text-xs text-muted-foreground">{formatRelativeTime(event.createdAt)}</span>
      </div>
    </div>
  )
}

function RoleUpdatedEventCard({ event }: { event: CommunityActivityEvent }) {
  const toRole = (event.metadata?.toRole as string) ?? null

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        {event.subject ? (
          <UserLink user={event.subject} />
        ) : (
          <UserLink user={event.actor} />
        )}
        <span className="text-muted-foreground shrink-0">
          role changed{toRole ? ` to ${toRole.toLowerCase()}` : ""}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <EventTypeBadge type={event.type} />
        <span className="text-xs text-muted-foreground">{formatRelativeTime(event.createdAt)}</span>
      </div>
    </div>
  )
}

function GenericEventCard({ event }: { event: CommunityActivityEvent }) {
  const config = EVENT_TYPE_CONFIG[event.type]
  const description = event.type === "ORBIT_OVERRIDE"
    ? "orbit level updated"
    : event.type === "ATTESTATION_SUPERSEDED"
      ? "updated an attestation"
      : event.type.toLowerCase().replace(/_/g, " ")

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.actor} />
        <span className="text-muted-foreground shrink-0">{description}</span>
        {event.subject && (
          <>
            <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
            <UserLink user={event.subject} />
          </>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <EventTypeBadge type={event.type} />
        <span className="text-xs text-muted-foreground">{formatRelativeTime(event.createdAt)}</span>
      </div>
    </div>
  )
}

function ActivityEventCard({ event }: { event: CommunityActivityEvent }) {
  switch (event.type) {
    case "JOINED":
      return <JoinedEventCard event={event} />
    case "ATTESTED":
    case "ATTESTATION_RETRACTED":
      return <AttestationEventCard event={event} />
    case "ROLE_UPDATED":
      return <RoleUpdatedEventCard event={event} />
    default:
      return <GenericEventCard event={event} />
  }
}

// === FILTER PANEL ===

function FiltersPanel({
  filters,
  onFiltersChange,
  onClearAll,
  resultCount,
}: {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
  onClearAll: () => void
  resultCount: number
}) {
  const active = hasActiveFilters(filters)

  return (
    <Card aria-label="Event filters" className="bg-card/30 border-border/30">
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name, handle…"
            value={filters.q}
            onChange={(e) => onFiltersChange({ q: e.target.value })}
            aria-label="Search events"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Event type</div>
          <Select
            value={filters.type || null}
            onValueChange={(v) => onFiltersChange({ type: v ?? "" })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) => v ? EVENT_TYPE_CONFIG[v]?.label ?? v : "All types"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>All types</SelectItem>
                {EVENT_TYPE_LIST.map(([type, config]) => (
                  <SelectItem key={type} value={type}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {active && (
          <>
            <Separator className="sm:col-span-2" />
            <div className="flex items-center justify-center gap-2 sm:col-span-2">
              <Badge variant="secondary">
                {resultCount} results
              </Badge>
              <Button type="button" variant="destructive" size="sm" onClick={onClearAll}>
                Clear filters
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// === SKELETON ===

function ActivitySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-7 pb-40">
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
        <CardHeader className="gap-4">
          <CardTitle><Skeleton className="h-5 w-32" /></CardTitle>
          <CardDescription><Skeleton className="h-4 w-86" /></CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-2">
                <Skeleton className="size-8" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-12" />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

// === PAGE ===

type LoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "not-found" }
  | { status: "ready"; data: CommunityGetResponse }

export default function CommunityActivityPage() {
  const params = useParams<{ handle: string }>()
  const rawHandle = String(params?.handle ?? "")
  const handle = React.useMemo(() => normalizeHandle(rawHandle), [rawHandle])

  const { data: session } = useSession()
  const [state, setState] = React.useState<LoadState>({ status: "idle" })
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)

  const debouncedQ = useDebouncedValue(filters.q, 300)
  const activeFilters = React.useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ])

  // Fetch community data
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

  // Activity feed (fetches after community loads)
  const { events, loading: feedLoading, loadingMore, hasMore, loadMore } = useActivityFeed(
    handle,
    activeFilters,
  )

  // Client-side search filter
  const filteredEvents = React.useMemo(() => {
    if (!debouncedQ) return events
    const q = debouncedQ.toLowerCase()
    return events.filter((e) => {
      const actorName = displayName(e.actor).toLowerCase()
      const actorHandle = (e.actor.handle ?? "").toLowerCase()
      const subjectName = e.subject ? displayName(e.subject).toLowerCase() : ""
      const subjectHandle = (e.subject?.handle ?? "").toLowerCase()
      return actorName.includes(q) || actorHandle.includes(q) || subjectName.includes(q) || subjectHandle.includes(q)
    })
  }, [events, debouncedQ])

  if (state.status === "loading" || state.status === "idle") {
    return <ActivitySkeleton />
  }

  if (state.status === "not-found") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
        <Alert>
          <AlertDescription>We couldn&apos;t find this community.</AlertDescription>
        </Alert>
      </div>
    )
  }

  if (state.status === "error") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
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

  const { community, isAdmin } = state.data
  const handleLabel = handle
  const avatarSrc = community.avatarUrl ?? ""

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar type="community" src={avatarSrc} name={community.name} className="h-12 w-12" />
        }
        title={community.name}
        description={`@${handleLabel}`}
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            actions={[
              { label: "Filters", active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) },
            ]}
            nav={[
              { label: "Profile", href: communityPath(handleLabel) },
              { label: "Orbit", href: communityOrbitPath(handleLabel) },
              { label: "Members", href: communityMembersPath(handleLabel) },
              { label: "Activity", href: communityActivityPath(handleLabel) },
            ]}
            overflow={isAdmin ? [
              { label: "Applications", href: communityApplicationsPath(handleLabel) },
              { label: "Bans", href: communityBansPath(handleLabel) },
              { label: "Permissions", href: communityPermissionsPath(handleLabel) },
              { label: "Settings", href: communitySettingsPath(handleLabel) },
            ] : undefined}
          />
        }
      />

      {isFiltersOpen && (
        <FiltersPanel
          filters={filters}
          onFiltersChange={(updates) => setFilters((prev) => ({ ...prev, ...updates }))}
          onClearAll={() => setFilters(EMPTY_FILTERS)}
          resultCount={filteredEvents.length}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Recent events in this community.</CardDescription>
        </CardHeader>
        <CardContent>
          {feedLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-8" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
              No activity yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {filteredEvents.map((event) => (
                <ActivityEventCard key={event.id} event={event} />
              ))}

              {hasMore && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="mx-auto mt-2"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
