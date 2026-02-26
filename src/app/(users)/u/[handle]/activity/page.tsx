"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  ArrowDownLeft,
  LayoutGrid,
  Link2,
  List,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet } from "@/lib/api/client"
import { ROUTES, userPath, userActivityPath, userAttestationsPath, userSettingsPath } from "@/lib/routes"
import { ATTESTATION_TYPES, ATTESTATION_TYPE_LIST, type AttestationType } from "@/lib/attestations/definitions"
import { AttestationBadge } from "@/components/attestation/badge"
import { useAttestationQueue } from "@/components/attestation/queue-provider"

import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { ProfileAvatar } from "@/components/common/profile-avatar"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader } from "@/components/ui/card"
import { InfiniteScroll } from "@/components/ui/infinite-scroll"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

// === CONSTANTS ===

const PAGE_SIZE = 50

// === TYPES ===

type AttestationUser = {
  id: string
  handle: string | null
  name: string | null
  avatarUrl: string | null
  headline: string | null
}

type Attestation = {
  id: string
  type: AttestationType
  confidence: number | null
  createdAt: string
  mintedAt: string | null
  fromUser: AttestationUser
  toUser: AttestationUser
}

type AttestationsResponse = {
  attestations: Attestation[]
  nextCursor: string | null
}

type FilterState = {
  q: string
  type: AttestationType | ""
}

// === UTILITY FUNCTIONS ===

function formatAttestationDate(iso: string): string {
  const ts = Date.parse(iso)
  if (!Number.isFinite(ts)) return ""

  const diff = Date.now() - ts
  const hours = Math.floor(diff / 1000 / 60 / 60)

  if (hours < 1) {
    const minutes = Math.floor(diff / 1000 / 60)
    if (minutes < 1) return "just now"
    return `${minutes}m ago`
  }

  if (hours < 24) {
    return `${hours}h ago`
  }

  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, "0")
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + ` at ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function mergeAttestationsUnique(prev: Attestation[], next: Attestation[]): Attestation[] {
  const out: Attestation[] = []
  const seen = new Set<string>()

  for (const a of prev) {
    if (!a || seen.has(a.id)) continue
    seen.add(a.id)
    out.push(a)
  }

  for (const a of next) {
    if (!a || seen.has(a.id)) continue
    seen.add(a.id)
    out.push(a)
  }

  return out
}

function hasActiveFilters(filters: FilterState): boolean {
  return Boolean(filters.q || filters.type)
}

// === CUSTOM HOOKS ===

type UserProfile = {
  name: string | null
  avatarUrl: string | null
  image: string | null
}

function useUserProfile(handle: string) {
  const [profile, setProfile] = React.useState<UserProfile | null>(null)

  React.useEffect(() => {
    if (!handle) return

    const ac = new AbortController()

    void (async () => {
      const res = await apiGet<{ user: UserProfile }>(
        "/api/user/get",
        { handle },
        { signal: ac.signal },
      )
      if (!ac.signal.aborted && res.ok) {
        setProfile(res.value.user)
      }
    })()

    return () => ac.abort()
  }, [handle])

  return profile
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])

  return debounced
}

function useActivityData(
  handle: string,
  filters: FilterState,
  cursor: string | null,
  /** Timestamp of last cart save - triggers refetch when changed */
  lastChangedAt: number = 0,
) {
  const router = useRouter()
  const [items, setItems] = React.useState<Attestation[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [filtering, setFiltering] = React.useState(false)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const hasLoadedOnce = React.useRef(false)

  const debouncedQ = useDebouncedValue(filters.q, 300)

  // Always fetch received attestations (toHandle = handle)
  const queryParams = React.useMemo(() => {
    const params: Record<string, string> = {
      take: String(PAGE_SIZE),
      toHandle: handle,
    }

    if (filters.type) {
      params.type = filters.type
    }

    if (cursor) {
      params.cursor = cursor
    }

    return params
  }, [handle, filters.type, cursor])

  React.useEffect(() => {
    const ac = new AbortController()

    async function load() {
      setError(null)
      if (cursor !== null) {
        setLoadingMore(true)
      } else if (hasLoadedOnce.current) {
        setFiltering(true)
      } else {
        setLoading(true)
      }

      try {
        const res = await apiGet<AttestationsResponse>("/api/attestation/list", queryParams, {
          signal: ac.signal,
        })

        if (ac.signal.aborted) return

        if (!res.ok) {
          if ("status" in res.error && res.error.status === 401) {
            router.replace(ROUTES.signIn)
            return
          }
          setError("We couldn't load activity. Try again.")
          setLoading(false)
          setFiltering(false)
          setLoadingMore(false)
          return
        }

        const attestations = res.value.attestations
        setItems((prev) => cursor ? mergeAttestationsUnique(prev, attestations) : attestations)
        setNextCursor(res.value.nextCursor)
        hasLoadedOnce.current = true
        setLoading(false)
        setFiltering(false)
        setLoadingMore(false)
      } catch {
        if (!ac.signal.aborted) {
          setError("An unexpected error occurred.")
          setLoading(false)
          setFiltering(false)
          setLoadingMore(false)
        }
      }
    }

    void load()

    return () => {
      ac.abort()
    }
  }, [router, queryParams, cursor, handle, filters.type, lastChangedAt])

  // Filter by search query client-side
  const filteredItems = React.useMemo(() => {
    if (!debouncedQ) return items

    const q = debouncedQ.toLowerCase()
    return items.filter((a) => {
      const fromName = a.fromUser.name?.toLowerCase() ?? ""
      const fromHandle = a.fromUser.handle?.toLowerCase() ?? ""
      const typeLabel = ATTESTATION_TYPES[a.type].label.toLowerCase()

      return (
        fromName.includes(q) ||
        fromHandle.includes(q) ||
        typeLabel.includes(q)
      )
    })
  }, [items, debouncedQ])

  return { items: filteredItems, nextCursor, loading, filtering, loadingMore, error }
}

// === SUB-COMPONENTS ===

function ActivityCard({
  attestation,
}: {
  attestation: Attestation
}) {
  const otherUser = attestation.fromUser
  const displayName = otherUser.name?.trim() || `@${otherUser.handle}`
  const href = userPath(otherUser.handle ?? otherUser.id)
  const isMinted = !!attestation.mintedAt

  return (
    <Card
      size="sm"
      className="transition-colors"
    >
      {/* Header: avatar + name on left, status badge on right */}
      <CardHeader className="flex-row items-center gap-3">
        <div className="flex items-center gap-3">
          <Link href={href}>
            <ProfileAvatar type="user" src={otherUser.avatarUrl} name={displayName} className="size-9" />
          </Link>
          <div className="min-w-0">
            <Link href={href} className="hover:underline">
              <span className="truncate text-sm font-medium">{displayName}</span>
            </Link>
            {otherUser.handle && (
              <div className="truncate text-xs text-muted-foreground">@{otherUser.handle}</div>
            )}
          </div>
        </div>
        <CardAction>
          <div className="flex items-center gap-2">
            {isMinted ? (
              <Badge variant="positive" className="gap-1">
                <Link2 className="size-3" />
                Published
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1">
                Pending
              </Badge>
            )}
          </div>
        </CardAction>
      </CardHeader>

      {/* Body: Received [type] on [date] */}
      <CardContent className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
        <Badge variant="default" className="gap-1">
          <ArrowDownLeft className="size-3" />
          Received
        </Badge>
        <AttestationBadge type={attestation.type} />
        <Separator orientation="vertical" className="!h-4 mx-1" />
        <span>{formatAttestationDate(attestation.createdAt)}</span>
      </CardContent>
    </Card>
  )
}

function ActivityCardSkeleton() {
  return (
    <Card size="sm">
      <CardHeader className="flex-row items-center gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <CardAction>
          <Skeleton className="h-5 w-16 rounded-full" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Skeleton className="h-5 w-18 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-4 w-px" />
        <Skeleton className="h-6 w-16 rounded-md" />
      </CardContent>
    </Card>
  )
}

function ActivityRowSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] gap-3 px-4 py-3">
      <div className="flex items-center min-w-0">
        <div className="inline-flex items-center gap-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex flex-col gap-1">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      </div>
      <div className="flex items-center"><Skeleton className="h-5 w-20 rounded-full" /></div>
      <div className="flex items-center"><Skeleton className="h-3 w-12" /></div>
      <div className="flex items-center"><Skeleton className="h-5 w-16 rounded-full" /></div>
    </div>
  )
}

function ActivityGridSkeleton({ view }: { view: "cards" | "list" }) {
  if (view === "cards") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <ActivityCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/30 overflow-hidden">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium text-foreground/70">
        <div>From</div>
        <div>Type</div>
        <div>Date</div>
        <div>Status</div>
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <ActivityRowSkeleton key={i} />
      ))}
    </div>
  )
}

function ActivityRow({
  attestation,
}: {
  attestation: Attestation
}) {
  const otherUser = attestation.fromUser
  const isMinted = !!attestation.mintedAt
  const displayName = otherUser.name?.trim() || `@${otherUser.handle}`
  const href = userPath(otherUser.handle ?? otherUser.id)

  return (
    <div
      className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] gap-3 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted"
    >
      <div className="flex items-center min-w-0">
        <Link href={href} className="inline-flex min-w-0 items-center gap-3 rounded-md px-1.5 py-1 -mx-1.5 -my-1 transition-colors hover:text-primary">
          <ProfileAvatar type="user" src={otherUser.avatarUrl} name={displayName} className="h-8 w-8 shrink-0" />
          <div className="min-w-0">
            <div className="truncate font-medium">{displayName}</div>
            {otherUser.handle && (
              <div className="truncate text-xs text-muted-foreground">@{otherUser.handle}</div>
            )}
          </div>
        </Link>
      </div>

      <div className="flex items-center">
        <AttestationBadge type={attestation.type} />
      </div>

      <div className="flex items-center text-xs text-muted-foreground">
        {formatAttestationDate(attestation.createdAt)}
      </div>

      <div className="flex items-center">
        {isMinted ? (
          <Badge variant="positive" className="gap-1">
            Published
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            Pending
          </Badge>
        )}
      </div>
    </div>
  )
}

// === LOADING SKELETON (matches settings page pattern) ===

function ActivitySkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      {/* PageHeader skeleton */}
      <div className="w-full p-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Skeleton className="size-12 rounded-full shrink-0" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-7 w-36" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-64 rounded-4xl" />
        </div>
      </div>

      {/* Attestation cards grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <ActivityCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

// === FILTER PANEL ===

function FiltersPanel({
  filters,
  onFiltersChange,
  onClearAll,
  itemCount,
  hasMore,
}: {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
  onClearAll: () => void
  itemCount: number
  hasMore: boolean
}) {
  const active = hasActiveFilters(filters)

  return (
    <Card aria-label="Activity filters" className="bg-card/30 border-border/30">
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name, handle, type…"
            value={filters.q}
            onChange={(e) => onFiltersChange({ q: e.target.value })}
            aria-label="Search activity"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Attestation type</div>
          <Select
            value={filters.type || null}
            onValueChange={(v) => onFiltersChange({ type: (v ?? "") as AttestationType | "" })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(v: string | null) => {
                  if (!v) return "All types"
                  const def = ATTESTATION_TYPES[v as AttestationType]
                  return def ? `${def.emoji} ${def.label}` : v
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>All types</SelectItem>
                {ATTESTATION_TYPE_LIST.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.emoji} {t.label}
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
                {itemCount}{hasMore ? "+" : ""} attestations
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

// === CONTENT SECTIONS ===

function ActivityGrid({
  items,
  view,
}: {
  items: Attestation[]
  view: "cards" | "list"
}) {
  if (view === "cards") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {items.map((a) => (
          <ActivityCard
            key={a.id}
            attestation={a}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/30 overflow-hidden">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,0.8fr)] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium text-foreground/70">
        <div>From</div>
        <div>Type</div>
        <div>Date</div>
        <div>Status</div>
      </div>

      {items.map((a) => (
        <ActivityRow
          key={a.id}
          attestation={a}
        />
      ))}
    </div>
  )
}

function EmptyState({ hasFilters, onClearFilters }: { hasFilters: boolean; onClearFilters: () => void }) {
  return (
    <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
      <p>No activity found.</p>
      {hasFilters && (
        <Button
          type="button"
          variant="link"
          onClick={onClearFilters}
          className="mt-2"
        >
          Clear all filters
        </Button>
      )}
    </div>
  )
}

// === MAIN COMPONENT ===

export default function ActivityPage() {
  const params = useParams<{ handle: string }>()
  const { data: session } = useSession()
  const handle = params.handle?.trim() || ""

  const isSelf = session?.user?.handle === handle
  const profile = useUserProfile(handle)

  const displayName = profile?.name?.trim() || `@${handle}`
  const avatarSrc = profile?.avatarUrl || profile?.image || ""

  // Get lastChangedAt from queue context to trigger refetch when cart saves
  const { lastChangedAt } = useAttestationQueue()

  const [view, setView] = React.useState<"cards" | "list">("cards")
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)

  const [filters, setFilters] = React.useState<FilterState>({
    q: "",
    type: "",
  })

  // Reset cursor when cart saves to force fresh fetch from page 1
  React.useEffect(() => {
    if (lastChangedAt > 0) {
      setCursor(null)
    }
  }, [lastChangedAt])

  const { items, nextCursor, loading, filtering, loadingMore, error } = useActivityData(
    handle,
    filters,
    cursor,
    lastChangedAt,
  )

  const activeFilters = hasActiveFilters(filters)

  // Reset paging when filters change
  React.useEffect(() => {
    setCursor(null)
  }, [filters.q, filters.type])

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters({
      q: "",
      type: "",
    })
  }

  if (!handle) return null

  // Full-page skeleton only on the very first load
  if (loading) return <ActivitySkeleton />

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar type="user" src={avatarSrc} name={displayName} className="h-12 w-12" />
        }
        title="Activity"
        description={`@${handle}`}
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            actions={[
              { label: "Filters", active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) },
            ]}
            viewSwitch={{
              value: view,
              onChange: (v) => setView(v as "cards" | "list"),
              options: [
                { value: "cards", icon: LayoutGrid, label: "Cards" },
                { value: "list", icon: List, label: "List" },
              ],
            }}
            nav={[
              { label: "Profile", href: userPath(handle) },
              { label: "Attestations", href: userAttestationsPath(handle) },
              { label: "Activity", href: userActivityPath(handle) },
              ...(isSelf ? [{ label: "Settings", href: userSettingsPath(handle) }] : []),
            ]}
          />
        }
      />

      {isFiltersOpen && (
        <FiltersPanel
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onClearAll={handleClearAll}
          itemCount={items.length}
          hasMore={!!nextCursor}
        />
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loading || filtering ? "Loading activity..." : `${items.length} items loaded`}
      </div>

      <div className="flex flex-col gap-3">
        {filtering ? (
          <ActivityGridSkeleton view={view} />
        ) : items.length === 0 ? (
          <EmptyState hasFilters={activeFilters} onClearFilters={handleClearAll} />
        ) : (
          <InfiniteScroll
            onLoadMore={() => setCursor(nextCursor)}
            hasMore={!!nextCursor}
            isLoading={loadingMore}
          >
            <ActivityGrid
              items={items}
              view={view}
            />
          </InfiniteScroll>
        )}
      </div>
    </div>
  )
}
