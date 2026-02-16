"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowDownLeft,
  ArrowUpRight,
  UserPlus,
  Users,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api/client"
import { userPath, communityPath } from "@/lib/routes"

import { ProfileAvatar } from "@/components/common/profile-avatar"
import { PageHeader } from "@/components/common/page-header"
import { RefreshButton } from "@/components/common/refresh-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

// === TYPES ===

type ActivityUser = {
  id: string
  handle: string | null
  name: string | null
  avatarUrl: string | null
}

type AttestationEvent = {
  kind: "attestation"
  id: string
  createdAt: string
  fromUser: ActivityUser
  toUser: ActivityUser
  attestationType: string
  attestationTypeLabel: string
  mintedAt: string | null
}

type UserJoinedEvent = {
  kind: "user_joined"
  id: string
  createdAt: string
  user: ActivityUser
}

type CommunityCreatedEvent = {
  kind: "community_created"
  id: string
  createdAt: string
  community: {
    id: string
    handle: string | null
    name: string
    icon: string | null
    avatarUrl: string | null
  }
  creator: ActivityUser
}

type ActivityEvent = AttestationEvent | UserJoinedEvent | CommunityCreatedEvent

type ActivityResponse = {
  events: ActivityEvent[]
  nextCursor: string | null
}

type LeaderboardEntry = {
  user: {
    id: string
    handle: string | null
    name: string | null
    avatarUrl: string | null
  }
  receivedCount: number
  givenCount: number
}

type LeaderboardResponse = {
  entries: LeaderboardEntry[]
}

type FilterState = {
  q: string
  kind: ActivityEvent["kind"] | ""
}

// === HOOKS ===

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])

  return debounced
}

function useActivityFeed() {
  const [events, setEvents] = React.useState<ActivityEvent[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)

  const load = React.useCallback(async (cursor?: string) => {
    const isInitial = !cursor
    if (isInitial) setLoading(true)
    else setLoadingMore(true)

    const params: Record<string, string> = { take: "100" }
    if (cursor) params.cursor = cursor

    const res = await apiGet<ActivityResponse>("/api/activity/list", params)

    if (res.ok) {
      setEvents((prev) => isInitial ? res.value.events : [...prev, ...res.value.events])
      setNextCursor(res.value.nextCursor)
    }

    setLoading(false)
    setLoadingMore(false)
  }, [])

  React.useEffect(() => { void load() }, [load])

  const loadMore = React.useCallback(() => {
    if (nextCursor && !loadingMore) void load(nextCursor)
  }, [nextCursor, loadingMore, load])

  const refresh = React.useCallback(() => { void load() }, [load])

  return { events, loading, loadingMore, hasMore: !!nextCursor, loadMore, refresh }
}

function useLeaderboard(refreshKey: number) {
  const [entries, setEntries] = React.useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    setLoading(true)
    const ac = new AbortController()

    void (async () => {
      const res = await apiGet<LeaderboardResponse>(
        "/api/attestation/leaderboard",
        { take: "100" },
        { signal: ac.signal },
      )
      if (ac.signal.aborted) return
      if (res.ok) setEntries(res.value.entries)
      setLoading(false)
    })()

    return () => { ac.abort() }
  }, [refreshKey])

  return { entries, loading }
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
  return Boolean(filters.q || filters.kind)
}

/** Extract searchable text from any event for client-side filtering. */
function eventSearchText(event: ActivityEvent): string {
  switch (event.kind) {
    case "attestation":
      return [
        event.fromUser.name, event.fromUser.handle,
        event.toUser.name, event.toUser.handle,
        event.attestationTypeLabel,
      ].filter(Boolean).join(" ").toLowerCase()
    case "user_joined":
      return [event.user.name, event.user.handle].filter(Boolean).join(" ").toLowerCase()
    case "community_created":
      return [
        event.creator.name, event.creator.handle,
        event.community.name, event.community.handle,
      ].filter(Boolean).join(" ").toLowerCase()
  }
}

// === ACTIVITY TYPE CONFIG ===
// Extensible map — add new activity types here as the platform grows.

const ACTIVITY_KIND_CONFIG: Record<ActivityEvent["kind"], { label: string; className: string }> = {
  attestation: {
    label: "Attestation",
    className: "bg-primary/10 text-primary",
  },
  user_joined: {
    label: "New User",
    className: "bg-emerald-500/10 text-emerald-500",
  },
  community_created: {
    label: "New Community",
    className: "bg-accent/10 text-accent",
  },
}

const ACTIVITY_KIND_LIST = Object.entries(ACTIVITY_KIND_CONFIG) as Array<
  [ActivityEvent["kind"], { label: string; className: string }]
>

function ActivityTypeBadge({ kind }: { kind: ActivityEvent["kind"] }) {
  const config = ACTIVITY_KIND_CONFIG[kind]
  return (
    <Badge variant="secondary" className={`shrink-0 ${config.className}`}>
      {config.label}
    </Badge>
  )
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

// === EVENT CARDS ===

function AttestationEventCard({ event }: { event: AttestationEvent }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.fromUser} />
        <ArrowUpRight className="size-3 shrink-0 text-muted-foreground" />
        <UserLink user={event.toUser} />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <ActivityTypeBadge kind="attestation" />
        <Badge variant="outline" className="text-xs">
          {event.attestationTypeLabel}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    </div>
  )
}

function UserJoinedEventCard({ event }: { event: UserJoinedEvent }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.user} />
        <span className="text-muted-foreground shrink-0">joined the platform</span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <ActivityTypeBadge kind="user_joined" />
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    </div>
  )
}

function CommunityCreatedEventCard({ event }: { event: CommunityCreatedEvent }) {
  const communityHref = event.community.handle
    ? communityPath(event.community.handle)
    : null

  const communityContent = (
    <>
      <ProfileAvatar type="community" src={event.community.avatarUrl} name={event.community.name} size="sm" />
      <span className="truncate text-sm font-medium">{event.community.icon ? `${event.community.icon} ` : ""}{event.community.name}</span>
    </>
  )

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <UserLink user={event.creator} />
        <span className="text-muted-foreground shrink-0">created</span>
        {communityHref ? (
          <Link href={communityHref} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
            {communityContent}
          </Link>
        ) : (
          <span className="flex items-center gap-2 min-w-0">
            {communityContent}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <ActivityTypeBadge kind="community_created" />
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(event.createdAt)}
        </span>
      </div>
    </div>
  )
}

function ActivityEventCard({ event }: { event: ActivityEvent }) {
  switch (event.kind) {
    case "attestation":
      return <AttestationEventCard event={event} />
    case "user_joined":
      return <UserJoinedEventCard event={event} />
    case "community_created":
      return <CommunityCreatedEventCard event={event} />
  }
}

// === FILTER PANEL ===

function FiltersPanel({
  filters,
  onFiltersChange,
}: {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card/30 p-4" aria-label="Activity filters">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name, handle, community…"
            value={filters.q}
            onChange={(e) => onFiltersChange({ q: e.target.value })}
            aria-label="Search activity"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Activity type</div>
          <select
            value={filters.kind}
            onChange={(e) => onFiltersChange({ kind: e.target.value as FilterState["kind"] })}
            className="h-9 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All types</option>
            {ACTIVITY_KIND_LIST.map(([kind, config]) => (
              <option key={kind} value={kind}>
                {config.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </section>
  )
}

// === SKELETON ===

function ActivitySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-7 pb-40">
      <div className="w-full flex flex-wrap gap-3 p-5">
        <Skeleton className="size-12 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-3 w-24" />
        </div>
        <div className="flex gap-3 ml-auto sm:align-center sm:justify-end">
          <Skeleton className="h-9 w-14" />
          <Skeleton className="h-9 w-14" />
          <Skeleton className="h-9 w-14" />
        </div>
      </div>

      <Card>
        <CardHeader className="gap-4">
          <CardTitle>
            <Skeleton className="h-5 w-32" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-86" />
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
              <div className="flex items-center gap-2">
                <Skeleton className="size-8" />
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-4" />
                <Skeleton className="size-8" />
                <Skeleton className="h-4 w-24" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-20" />
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

// === SECTIONS ===

function ActivityFeedContent({
  events,
  loadingMore,
  hasMore,
  onLoadMore,
}: {
  events: ActivityEvent[]
  loadingMore: boolean
  hasMore: boolean
  onLoadMore: () => void
}) {
  if (events.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
        No activity found.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {events.map((event) => (
        <ActivityEventCard key={event.id} event={event} />
      ))}

      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loadingMore}
          className="flex items-center justify-center rounded-lg border border-border/60 py-2.5 text-sm text-muted-foreground transition-colors hover:border-accent/30 hover:text-accent disabled:opacity-50"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  )
}

function LeaderboardContent({ refreshKey }: { refreshKey: number }) {
  const { entries, loading } = useLeaderboard(refreshKey)

  if (loading) {
    return (
      <div className="flex flex-col gap-0">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 py-3 px-2 border-b border-border/40 last:border-b-0">
            <Skeleton className="h-4 w-6" />
            <Skeleton className="size-8 rounded-full" />
            <div className="flex flex-col gap-1.5 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
        No attestations yet.
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {entries.map((entry, index) => {
        const name = displayName(entry.user)
        const href = entry.user.handle ? userPath(entry.user.handle) : "#"

        return (
          <div
            key={entry.user.id}
            className={cn(
              "flex items-center gap-4 py-3 px-2",
              index < entries.length - 1 && "border-b border-border/40",
            )}
          >
            <span className={cn(
              "w-6 text-center text-sm font-semibold",
              index === 0 && "text-amber-500",
              index === 1 && "text-muted-foreground",
              index === 2 && "text-orange-700",
              index > 2 && "text-muted-foreground/60",
            )}>
              {index + 1}
            </span>

            <Link href={href} className="flex items-center gap-3 min-w-0 flex-1 hover:opacity-80 transition-opacity">
              <ProfileAvatar type="user" src={entry.user.avatarUrl} name={name} size="sm" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{name}</div>
                {entry.user.handle && (
                  <div className="truncate text-xs text-muted-foreground">@{entry.user.handle}</div>
                )}
              </div>
            </Link>

            <div className="flex items-center gap-4 shrink-0 text-xs">
              <div className="flex items-center gap-1">
                <ArrowDownLeft className="size-3 text-emerald-500" />
                <span className="font-medium">{entry.receivedCount}</span>
                <span className="text-muted-foreground hidden sm:inline">received</span>
              </div>
              <div className="flex items-center gap-1">
                <ArrowUpRight className="size-3 text-amber-500" />
                <span className="font-medium">{entry.givenCount}</span>
                <span className="text-muted-foreground hidden sm:inline">given</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// === MAIN ===

export default function ActivityPage() {
  const [tab, setTab] = React.useState<"activity" | "leaderboard">("activity")
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)
  const [filters, setFilters] = React.useState<FilterState>({ q: "", kind: "" })
  const [refreshKey, setRefreshKey] = React.useState(0)

  const { events: rawEvents, loading, loadingMore, hasMore, loadMore, refresh } = useActivityFeed()

  const debouncedQ = useDebouncedValue(filters.q, 300)
  const activeFilters = hasActiveFilters(filters)

  // Client-side filtering
  const filteredEvents = React.useMemo(() => {
    let result = rawEvents

    if (filters.kind) {
      result = result.filter((e) => e.kind === filters.kind)
    }

    if (debouncedQ) {
      const q = debouncedQ.toLowerCase()
      result = result.filter((e) => eventSearchText(e).includes(q))
    }

    return result
  }, [rawEvents, filters.kind, debouncedQ])

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters({ q: "", kind: "" })
  }

  function handleRefresh() {
    refresh()
    setRefreshKey((k) => k + 1)
  }

  if (loading) {
    return <ActivitySkeleton />
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
      <Tabs className="gap-0" value={tab} onValueChange={(v) => setTab(v as "activity" | "leaderboard")}>
        <PageHeader
          title="Activity"
          description="Recent activity across the platform"
          actionsAsFormActions={false}
          actions={
            <div className="flex w-full items-center gap-2">
              {tab === "activity" && (
                <>
                  {activeFilters && (
                    <Button type="button" variant="ghost" onClick={handleClearAll}>
                      Reset
                    </Button>
                  )}
                  <Button type="button" variant="secondary" onClick={() => setIsFiltersOpen((v) => !v)}>
                    {isFiltersOpen ? "Hide filters" : "Show filters"}
                  </Button>
                </>
              )}
              <div className="ml-auto flex items-center gap-2">
                <TabsList className="bg-primary/10">
                  <TabsTrigger value="activity" className="data-active:bg-accent data-active:text-accent-foreground">Activity</TabsTrigger>
                  <TabsTrigger value="leaderboard" className="data-active:bg-accent data-active:text-accent-foreground">Leaderboard</TabsTrigger>
                </TabsList>
                <RefreshButton onRefresh={handleRefresh} />
              </div>
            </div>
          }
        />

        <TabsContent value="activity" className="flex flex-col gap-6">
          {isFiltersOpen && (
            <FiltersPanel
              filters={filters}
              onFiltersChange={handleFiltersChange}
            />
          )}

          {activeFilters && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{filteredEvents.length} results</Badge>
              {filters.kind && (
                <Badge variant="outline" className="gap-1.5">
                  Type: {ACTIVITY_KIND_CONFIG[filters.kind].label}
                  <button
                    type="button"
                    className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => handleFiltersChange({ kind: "" })}
                    aria-label="Remove type filter"
                  >
                    ×
                  </button>
                </Badge>
              )}
              {filters.q && (
                <Badge variant="outline" className="gap-1.5">
                  Search: {filters.q}
                  <button
                    type="button"
                    className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => handleFiltersChange({ q: "" })}
                    aria-label="Remove search filter"
                  >
                    ×
                  </button>
                </Badge>
              )}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>What&apos;s happening across the platform</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ActivityFeedContent
                events={filteredEvents}
                loadingMore={loadingMore}
                hasMore={hasMore && !activeFilters}
                onLoadMore={loadMore}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="leaderboard">
          <Card>
            <CardHeader>
              <CardTitle>Leaderboard</CardTitle>
              <CardDescription>Most attested users on the platform</CardDescription>
            </CardHeader>
            <CardContent>
              <LeaderboardContent refreshKey={refreshKey} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
