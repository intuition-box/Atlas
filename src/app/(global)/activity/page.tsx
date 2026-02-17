"use client"

import * as React from "react"
import Link from "next/link"
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarIcon,
  Globe,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api/client"
import { userPath, communityPath } from "@/lib/routes"
import { ATTESTATION_TYPES, ATTESTATION_TYPE_LIST, type AttestationType } from "@/lib/attestations/definitions"
import { AttestationBadge } from "@/components/attestation/badge"

import { ProfileAvatar } from "@/components/common/profile-avatar"
import { PageHeader } from "@/components/common/page-header"
import { RefreshButton } from "@/components/common/refresh-button"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
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
  attestationType: AttestationType | ""
  direction: "given" | "received" | ""
  onchain: "onchain" | "offchain" | ""
  dateFrom: string // ISO date string (YYYY-MM-DD) or ""
  dateTo: string   // ISO date string (YYYY-MM-DD) or ""
}

const EMPTY_FILTERS: FilterState = {
  q: "",
  kind: "",
  attestationType: "",
  direction: "",
  onchain: "",
  dateFrom: "",
  dateTo: "",
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

function useActivityFeed(filters: FilterState) {
  const [events, setEvents] = React.useState<ActivityEvent[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)

  // Serialize filters for dependency comparison (excludes cursor)
  const filtersKey = JSON.stringify(filters)

  const load = React.useCallback(async (cursor?: string) => {
    const isInitial = !cursor
    if (isInitial) setLoading(true)
    else setLoadingMore(true)

    const params: Record<string, string> = { take: "100" }
    if (cursor) params.cursor = cursor
    if (filters.kind) params.kind = filters.kind
    if (filters.attestationType) params.attestationType = filters.attestationType
    if (filters.direction) params.direction = filters.direction
    if (filters.onchain) params.onchain = filters.onchain
    if (filters.q) params.q = filters.q
    if (filters.dateFrom) params.dateFrom = filters.dateFrom
    if (filters.dateTo) params.dateTo = filters.dateTo

    const res = await apiGet<ActivityResponse>("/api/activity/list", params)

    if (res.ok) {
      setEvents((prev) => isInitial ? res.value.events : [...prev, ...res.value.events])
      setNextCursor(res.value.nextCursor)
    }

    setLoading(false)
    setLoadingMore(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey])

  // Re-fetch on filter change
  React.useEffect(() => {
    setEvents([])
    setNextCursor(null)
    void load()
  }, [load])

  const loadMore = React.useCallback(() => {
    if (nextCursor && !loadingMore) void load(nextCursor)
  }, [nextCursor, loadingMore, load])

  const refresh = React.useCallback(() => {
    setEvents([])
    setNextCursor(null)
    void load()
  }, [load])

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
  return Boolean(filters.q || filters.kind || filters.attestationType || filters.direction || filters.onchain || filters.dateFrom || filters.dateTo)
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
        <ArrowUpRight className="size-3 shrink-0 text-amber-500" />
        <UserLink user={event.toUser} />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <AttestationBadge type={event.attestationType} />
        <ActivityTypeBadge kind="attestation" />
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

// === DATE RANGE PICKER ===

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
}

function DateRangePicker({
  from,
  to,
  onChange,
}: {
  from: Date | undefined
  to: Date | undefined
  onChange: (from: Date | undefined, to: Date | undefined) => void
}) {
  const hasRange = Boolean(from || to)

  const label = from && to
    ? `${formatDateLabel(from)} – ${formatDateLabel(to)}`
    : from
      ? `From ${formatDateLabel(from)}`
      : to
        ? `Until ${formatDateLabel(to)}`
        : "Pick a date range"

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "border-input bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 flex h-9 w-full items-center gap-2 rounded-4xl border px-3 text-sm transition-colors focus-visible:ring-[3px] outline-none",
          !hasRange && "text-muted-foreground",
        )}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{label}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="range"
          selected={from || to ? { from, to } : undefined}
          onSelect={(range) => onChange(range?.from, range?.to)}
          numberOfMonths={2}
          disabled={{ after: new Date() }}
        />
      </PopoverContent>
    </Popover>
  )
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
    <Card aria-label="Activity filters" className="bg-card/30 border-border/30">
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
          <Select
            value={filters.kind || null}
            onValueChange={(v) => onFiltersChange({ kind: (v ?? "") as FilterState["kind"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string | null) => v ? ACTIVITY_KIND_CONFIG[v as ActivityEvent["kind"]]?.label ?? v : "All types"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>All types</SelectItem>
                {ACTIVITY_KIND_LIST.map(([kind, config]) => (
                  <SelectItem key={kind} value={kind}>
                    {config.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Attestation type</div>
          <Select
            value={filters.attestationType || null}
            onValueChange={(v) => onFiltersChange({ attestationType: (v ?? "") as FilterState["attestationType"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) => {
                  if (!v) return "All attestations"
                  const def = ATTESTATION_TYPES[v as AttestationType]
                  return def ? `${def.emoji} ${def.label}` : v
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>All attestations</SelectItem>
                {ATTESTATION_TYPE_LIST.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.emoji} {t.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Direction</div>
          <Select
            value={filters.direction || null}
            onValueChange={(v) => onFiltersChange({ direction: (v ?? "") as FilterState["direction"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string | null) => v === "given" ? "Given" : v === "received" ? "Received" : "All"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>All</SelectItem>
                <SelectItem value="given">Given</SelectItem>
                <SelectItem value="received">Received</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Onchain status</div>
          <Select
            value={filters.onchain || null}
            onValueChange={(v) => onFiltersChange({ onchain: (v ?? "") as FilterState["onchain"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string | null) => v === "onchain" ? "Onchain" : v === "offchain" ? "Offchain" : "All"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>All</SelectItem>
                <SelectItem value="onchain">Onchain</SelectItem>
                <SelectItem value="offchain">Offchain</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Date range</div>
          <DateRangePicker
            from={filters.dateFrom ? new Date(filters.dateFrom) : undefined}
            to={filters.dateTo ? new Date(filters.dateTo) : undefined}
            onChange={(from, to) => onFiltersChange({
              dateFrom: from ? from.toISOString().slice(0, 10) : "",
              dateTo: to ? to.toISOString().slice(0, 10) : "",
            })}
          />
        </div>
      </CardContent>
    </Card>
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
      <div className="flex flex-col gap-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-4 w-6" />
              <Skeleton className="size-8 rounded-full" />
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-16" />
            </div>
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
    <div className="flex flex-col gap-2">
      {entries.map((entry, index) => {
        const name = displayName(entry.user)
        const href = entry.user.handle ? userPath(entry.user.handle) : "#"

        return (
          <div
            key={entry.user.id}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className={cn(
                "w-6 text-center text-sm font-semibold shrink-0",
                index === 0 && "text-amber-500",
                index === 1 && "text-muted-foreground",
                index === 2 && "text-orange-700",
                index > 2 && "text-muted-foreground/60",
              )}>
                {index + 1}
              </span>

              <Link href={href} className="flex items-center gap-3 min-w-0 hover:opacity-80 transition-opacity">
                <ProfileAvatar type="user" src={entry.user.avatarUrl} name={name} size="sm" />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{name}</div>
                  {entry.user.handle && (
                    <div className="truncate text-xs text-muted-foreground">@{entry.user.handle}</div>
                  )}
                </div>
              </Link>
            </div>

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
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS)
  const [refreshKey, setRefreshKey] = React.useState(0)

  // Debounce only the text search; other filters apply immediately
  const debouncedQ = useDebouncedValue(filters.q, 300)
  const apiFilters = React.useMemo<FilterState>(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ],
  )

  const { events, loading, loadingMore, hasMore, loadMore, refresh } = useActivityFeed(apiFilters)

  const activeFilters = hasActiveFilters(filters)

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters(EMPTY_FILTERS)
  }

  function handleRefresh() {
    refresh()
    setRefreshKey((k) => k + 1)
  }

  if (loading && !hasActiveFilters(apiFilters)) {
    return <ActivitySkeleton />
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 mt-24 pb-40">
      <Tabs className="gap-0" value={tab} onValueChange={(v) => setTab(v as "activity" | "leaderboard")}>
        <PageHeader
          leading={<Globe className="size-6 text-muted-foreground" />}
          title="Global Feed"
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
              <Badge variant="secondary">{events.length} results</Badge>
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
              {filters.attestationType && (
                <Badge variant="outline" className="gap-1.5">
                  {ATTESTATION_TYPES[filters.attestationType]?.emoji} {ATTESTATION_TYPES[filters.attestationType]?.label ?? filters.attestationType}
                  <button
                    type="button"
                    className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => handleFiltersChange({ attestationType: "" })}
                    aria-label="Remove attestation type filter"
                  >
                    ×
                  </button>
                </Badge>
              )}
              {filters.direction && (
                <Badge variant="outline" className="gap-1.5">
                  Direction: {filters.direction === "given" ? "Given" : "Received"}
                  <button
                    type="button"
                    className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => handleFiltersChange({ direction: "" })}
                    aria-label="Remove direction filter"
                  >
                    ×
                  </button>
                </Badge>
              )}
              {filters.onchain && (
                <Badge variant="outline" className="gap-1.5">
                  Status: {filters.onchain === "onchain" ? "Onchain" : "Offchain"}
                  <button
                    type="button"
                    className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => handleFiltersChange({ onchain: "" })}
                    aria-label="Remove onchain status filter"
                  >
                    ×
                  </button>
                </Badge>
              )}
              {(filters.dateFrom || filters.dateTo) && (
                <Badge variant="outline" className="gap-1.5">
                  Date: {filters.dateFrom && filters.dateTo
                    ? `${formatDateLabel(new Date(filters.dateFrom))} – ${formatDateLabel(new Date(filters.dateTo))}`
                    : filters.dateFrom
                      ? `From ${formatDateLabel(new Date(filters.dateFrom))}`
                      : `Until ${formatDateLabel(new Date(filters.dateTo))}`}
                  <button
                    type="button"
                    className="inline-flex size-3.5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
                    onClick={() => handleFiltersChange({ dateFrom: "", dateTo: "" })}
                    aria-label="Remove date filter"
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
              {loading ? (
                <div className="flex flex-col gap-2">
                  {[1, 2, 3, 4, 5].map((i) => (
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
                </div>
              ) : (
                <ActivityFeedContent
                  events={events}
                  loadingMore={loadingMore}
                  hasMore={hasMore}
                  onLoadMore={loadMore}
                />
              )}
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
