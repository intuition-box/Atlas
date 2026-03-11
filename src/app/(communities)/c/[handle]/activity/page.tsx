"use client"

import * as React from "react"
import { Search } from "lucide-react"

import { displayName } from "@/lib/format"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useActivityFeed } from "@/hooks/use-activity-feed"

import { EventFeed, type EventTypeConfig } from "@/components/activity/event-feed"
import { EventFiltersPanel } from "@/components/activity/event-filters-panel"
import { ListFeedSkeleton } from "@/components/common/list-feed"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

import { useCommunity } from "../community-provider"

// ── Types ──────────────────────────────────────────────────────────

type FilterState = {
  q: string
  type: string
}

const EMPTY_FILTERS: FilterState = { q: "", type: "" }

// ── Event type config ──────────────────────────────────────────────

const EVENT_TYPE_CONFIG: Record<string, EventTypeConfig> = {
  JOINED: { label: "Joined", variant: "positive" },
  ATTESTED: { label: "Attestation", variant: "default" },
  ATTESTATION_RETRACTED: { label: "Removed", variant: "destructive" },
  ATTESTATION_SUPERSEDED: { label: "Attestation Updated", variant: "secondary" },
  ROLE_UPDATED: { label: "Role Change", variant: "info" },
  ORBIT_OVERRIDE: { label: "Orbit Override", variant: "info" },
}

const EVENT_TYPE_OPTIONS = Object.entries(EVENT_TYPE_CONFIG).map(
  ([value, { label }]) => ({ value, label }),
)

// ── Page ───────────────────────────────────────────────────────────

export default function CommunityActivityPage() {
  const ctx = useCommunity()

  const [filters, setFilters] = React.useState<FilterState>(EMPTY_FILTERS)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)

  const debouncedQ = useDebouncedValue(filters.q, 300)
  const activeFilters = React.useMemo(
    () => ({ ...filters, q: debouncedQ }),
    [filters, debouncedQ],
  )

  // Inject toolbar slot — Filters button
  React.useEffect(() => {
    if (ctx.status !== "ready") {
      ctx.setToolbarSlot(null)
      return
    }
    ctx.setToolbarSlot({
      actions: [
        { label: "Filters", icon: Search, active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) },
      ],
    })
    return () => ctx.setToolbarSlot(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.status, isFiltersOpen])

  // Activity feed
  const feedParams = React.useMemo(() => ({ handle: ctx.handle }), [ctx.handle])
  const { events, loading: feedLoading, loadingMore, hasMore, loadMore } = useActivityFeed({
    endpoint: "/api/community/activity/list",
    params: feedParams,
    filters: { type: activeFilters.type },
  })

  // Client-side search filter
  const filteredEvents = React.useMemo(() => {
    if (!debouncedQ) return events
    const q = debouncedQ.toLowerCase()
    return events.filter((e) => {
      const actorName = displayName(e.actor).toLowerCase()
      const actorHandle = (e.actor.handle ?? "").toLowerCase()
      const subjectName = e.subject ? displayName(e.subject).toLowerCase() : ""
      const subjectHandle = (e.subject?.handle ?? "").toLowerCase()
      return (
        actorName.includes(q) ||
        actorHandle.includes(q) ||
        subjectName.includes(q) ||
        subjectHandle.includes(q)
      )
    })
  }, [events, debouncedQ])

  const hasActive = Boolean(filters.q || filters.type)
  const isLoading = ctx.status === "loading"

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="gap-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-86" />
        </CardHeader>
        <CardContent>
          <ListFeedSkeleton rows={8} />
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      {isFiltersOpen && (
        <EventFiltersPanel
          q={filters.q}
          filterValue={filters.type}
          filterLabel="Event type"
          filterOptions={EVENT_TYPE_OPTIONS}
          onSearchChange={(q) => setFilters((prev) => ({ ...prev, q }))}
          onFilterChange={(type) => setFilters((prev) => ({ ...prev, type }))}
          onClearAll={() => setFilters(EMPTY_FILTERS)}
          resultCount={filteredEvents.length}
          hasActiveFilters={hasActive}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
          <CardDescription>Recent events in this community.</CardDescription>
        </CardHeader>
        <CardContent>
          <EventFeed
            events={filteredEvents}
            loading={feedLoading}
            loadingMore={loadingMore}
            hasMore={hasMore}
            onLoadMore={loadMore}
            eventTypeConfig={EVENT_TYPE_CONFIG}
            emptyMessage="No activity yet."
          />
        </CardContent>
      </Card>
    </>
  )
}
