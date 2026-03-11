"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarIcon,
  Globe,
  Search,
  Trophy,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api/client"
import { formatRelativeTime, displayName } from "@/lib/format"
import { ROUTES, userPath, communityPath } from "@/lib/routes"
import { ATTESTATION_TYPES, ATTESTATION_TYPE_LIST, type AttestationType } from "@/lib/attestations/definitions"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useActivityFeed } from "@/hooks/use-activity-feed"

import { AttestationBadge } from "@/components/attestation/badge"
import { UserLink } from "@/components/activity/event-feed"
import { ListFeed, ListFeedSkeleton } from "@/components/common/list-feed"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
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

type GlobalActivityEvent = AttestationEvent | UserJoinedEvent | CommunityCreatedEvent

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
  kind: GlobalActivityEvent["kind"] | ""
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

function useLeaderboard() {
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
  }, [])

  return { entries, loading }
}

// === UTILITIES ===

function hasActiveFilters(filters: FilterState): boolean {
  return Boolean(filters.q || filters.kind || filters.attestationType || filters.direction || filters.onchain || filters.dateFrom || filters.dateTo)
}

// === ACTIVITY TYPE CONFIG ===

const ACTIVITY_KIND_CONFIG: Record<GlobalActivityEvent["kind"], { label: string; variant: "default" | "positive" | "info" | "destructive" | "secondary" }> = {
  attestation: {
    label: "Attestation",
    variant: "default",
  },
  user_joined: {
    label: "New User",
    variant: "positive",
  },
  community_created: {
    label: "New Community",
    variant: "positive",
  },
}

const ACTIVITY_KIND_LIST = Object.entries(ACTIVITY_KIND_CONFIG) as Array<
  [GlobalActivityEvent["kind"], { label: string; variant: string }]
>

function ActivityTypeBadge({ kind }: { kind: GlobalActivityEvent["kind"] }) {
  const config = ACTIVITY_KIND_CONFIG[kind]
  return (
    <Badge variant={config.variant} className="shrink-0">
      {config.label}
    </Badge>
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

function ActivityEventCard({ event }: { event: GlobalActivityEvent }) {
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
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* Row 1: Search, Date, Event type */}
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name, handle, community…"
            value={filters.q}
            onChange={(e) => onFiltersChange({ q: e.target.value })}
            aria-label="Search events"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Date</div>
          <DateRangePicker
            from={filters.dateFrom ? new Date(filters.dateFrom) : undefined}
            to={filters.dateTo ? new Date(filters.dateTo) : undefined}
            onChange={(from, to) => onFiltersChange({
              dateFrom: from ? from.toISOString().slice(0, 10) : "",
              dateTo: to ? to.toISOString().slice(0, 10) : "",
            })}
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Event type</div>
          <Select
            value={filters.kind || null}
            onValueChange={(v) => onFiltersChange({ kind: (v ?? "") as FilterState["kind"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string | null) => v ? ACTIVITY_KIND_CONFIG[v as GlobalActivityEvent["kind"]]?.label ?? v : "All types"}</SelectValue>
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

        {/* Row 2: Attestation type, Attestation direction, Attestation state */}
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
          <div className="text-xs font-medium text-foreground/70">Attestation direction</div>
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
          <div className="text-xs font-medium text-foreground/70">Attestation state</div>
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

        {active && (
          <>
            <Separator className="sm:col-span-2 lg:col-span-3" />
            <div className="flex items-center justify-center gap-2 sm:col-span-2 lg:col-span-3">
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
    <div className="mx-auto flex w-full max-w-4xl flex-col mt-24 gap-7 pb-40">
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
          <CardTitle>
            <Skeleton className="h-5 w-32" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-86" />
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ListFeedSkeleton rows={8} />
        </CardContent>
      </Card>
    </div>
  )
}

// === LEADERBOARD ROW ===

function LeaderboardRow({ entry, index }: { entry: LeaderboardEntry; index: number }) {
  const name = displayName(entry.user)
  const href = entry.user.handle ? userPath(entry.user.handle) : "#"

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
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

        <Link href={href} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
          <ProfileAvatar type="user" src={entry.user.avatarUrl} name={name} size="sm" />
          <span className="truncate text-sm font-medium">{name}</span>
          {entry.user.handle && (
            <span className="truncate text-xs text-muted-foreground">@{entry.user.handle}</span>
          )}
        </Link>
      </div>

      <div className="flex items-center gap-2 shrink-0 text-xs">
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
}

// === LEADERBOARD SECTION ===

function LeaderboardContent() {
  const { entries, loading } = useLeaderboard()

  return (
    <ListFeed<LeaderboardEntry>
      items={entries}
      keyExtractor={(entry) => entry.user.id}
      renderItem={(entry, index) => <LeaderboardRow entry={entry} index={index} />}
      loading={loading}
      emptyMessage="No attestations yet."
    />
  )
}

// === EVENTS SECTION ===

function EventsContent({
  filters,
}: {
  filters: FilterState
}) {
  const debouncedQ = useDebouncedValue(filters.q, 300)

  // Build API filter params (strip empty strings)
  const apiFilters = React.useMemo(() => {
    const f: Record<string, string> = {}
    if (debouncedQ) f.q = debouncedQ
    if (filters.kind) f.kind = filters.kind
    if (filters.attestationType) f.attestationType = filters.attestationType
    if (filters.direction) f.direction = filters.direction
    if (filters.onchain) f.onchain = filters.onchain
    if (filters.dateFrom) f.dateFrom = filters.dateFrom
    if (filters.dateTo) f.dateTo = filters.dateTo
    return f
  }, [debouncedQ, filters.kind, filters.attestationType, filters.direction, filters.onchain, filters.dateFrom, filters.dateTo])

  const emptyParams = React.useMemo(() => ({}), [])

  const { events, loading, loadingMore, hasMore, loadMore } = useActivityFeed<GlobalActivityEvent>({
    endpoint: "/api/activity/list",
    params: emptyParams,
    filters: apiFilters,
    take: 100,
  })

  return (
    <ListFeed<GlobalActivityEvent>
      items={events}
      keyExtractor={(event) => event.id}
      renderItem={(event) => <ActivityEventCard event={event} />}
      loading={loading}
      loadingMore={loadingMore}
      hasMore={hasMore}
      onLoadMore={loadMore}
      emptyMessage="No events found."
    />
  )
}

// === MAIN ===

export default function ActivityPage() {
  const { status } = useSession()
  const router = useRouter()

  // Redirect unauthenticated users to sign-in
  React.useEffect(() => {
    if (status === "unauthenticated") {
      router.replace(`${ROUTES.signIn}?returnToUrl=${encodeURIComponent(ROUTES.activity)}`)
    }
  }, [status, router])

  const [tab, setTab] = React.useState<"events" | "leaderboard">("leaderboard")
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)
  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS)

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters(EMPTY_FILTERS)
  }

  if (status !== "authenticated") {
    return <ActivitySkeleton />
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col mt-24 gap-6 pb-40">
      <PageHeader
        leading={
          <Avatar className="h-12 w-12 has-[[data-slot=avatar-fallback]]:after:border-primary/15">
            <AvatarFallback className="bg-primary/10 text-primary"><Globe className="size-5" /></AvatarFallback>
          </Avatar>
        }
        title="Activity"
        description="Global feed"
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            actions={tab === "events" ? [
              { label: "Filters", icon: Search, active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) },
            ] : undefined}
            viewSwitch={{
              value: tab,
              onChange: (v) => setTab(v as "events" | "leaderboard"),
              options: [
                { value: "leaderboard", label: "Leaderboard", icon: Trophy },
                { value: "events", label: "Events", icon: Activity },
              ],
            }}
          />
        }
      />

      {tab === "leaderboard" && (
        <Card>
          <CardHeader>
            <CardTitle>Leaderboard</CardTitle>
            <CardDescription>Most attested users on the platform</CardDescription>
          </CardHeader>
          <CardContent>
            <LeaderboardContent />
          </CardContent>
        </Card>
      )}

      {tab === "events" && (
        <div className="flex flex-col gap-6">
          {isFiltersOpen && (
            <FiltersPanel
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onClearAll={handleClearAll}
              resultCount={0}
            />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Events</CardTitle>
              <CardDescription>What&apos;s happening across the platform</CardDescription>
            </CardHeader>
            <CardContent>
              <EventsContent filters={filters} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
