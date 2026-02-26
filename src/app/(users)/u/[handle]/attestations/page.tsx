"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { ArrowUpRight, Link2, Undo2 } from "lucide-react"

import { apiGet, apiPost } from "@/lib/api/client"
import { formatRelativeTime } from "@/lib/format"
import { sounds } from "@/lib/sounds"
import { ROUTES, userPath, userActivityPath, userAttestationsPath, userSettingsPath } from "@/lib/routes"
import { ATTESTATION_TYPES, ATTESTATION_TYPE_LIST, type AttestationType } from "@/lib/attestations/definitions"
import { useDebouncedValue } from "@/hooks/use-debounced-value"

import { AttestationBadge } from "@/components/attestation/badge"
import { OnchainBanner } from "@/components/attestation/onchain-banner"
import { useAttestationQueue } from "@/components/attestation/queue-provider"
import { ListFeed, ListFeedSkeleton } from "@/components/common/list-feed"
import { PageHeader } from "@/components/common/page-header"
import { PageToolbar } from "@/components/common/page-toolbar"
import { ProfileAvatar } from "@/components/common/profile-avatar"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
  status: "published" | "pending" | ""
}

// === UTILITY FUNCTIONS ===

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
  return Boolean(filters.q || filters.type || filters.status)
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

function useAttestationsData(
  handle: string,
  filters: FilterState,
  cursor: string | null,
  /** Timestamp of last cart save — triggers refetch when changed */
  lastChangedAt: number = 0,
  /** Increment to force a refetch without a full page reload */
  refreshKey: number = 0,
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

  // Always fetch attestations given by this user
  const queryParams = React.useMemo(() => {
    const params: Record<string, string> = {
      fromHandle: handle,
      take: String(PAGE_SIZE),
    }

    if (filters.type) {
      params.type = filters.type
    }

    if (filters.status === "published") {
      params.minted = "true"
    } else if (filters.status === "pending") {
      params.minted = "false"
    }

    if (cursor) {
      params.cursor = cursor
    }

    return params
  }, [handle, filters.type, filters.status, cursor])

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
          setError("We couldn't load attestations. Try again.")
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
  }, [router, queryParams, cursor, handle, filters.type, filters.status, lastChangedAt, refreshKey])

  // Filter by search query client-side
  const filteredItems = React.useMemo(() => {
    if (!debouncedQ) return items

    const q = debouncedQ.toLowerCase()
    return items.filter((a) => {
      const toName = a.toUser.name?.toLowerCase() ?? ""
      const toHandle = a.toUser.handle?.toLowerCase() ?? ""
      const typeLabel = ATTESTATION_TYPES[a.type].label.toLowerCase()

      return toName.includes(q) || toHandle.includes(q) || typeLabel.includes(q)
    })
  }, [items, debouncedQ])

  return { items: filteredItems, nextCursor, loading, filtering, loadingMore, error }
}

// === SUB-COMPONENTS ===

function AttestationRow({
  attestation,
  viewerId,
  onRetract,
}: {
  attestation: Attestation
  viewerId: string | null
  onRetract?: (id: string) => void
}) {
  const [isRetracting, setIsRetracting] = React.useState(false)
  const otherUser = attestation.toUser
  const canRetract = viewerId === attestation.fromUser.id
  const isMinted = !!attestation.mintedAt
  const displayName = otherUser.name?.trim() || `@${otherUser.handle}`
  const href = userPath(otherUser.handle ?? otherUser.id)

  const handleRetract = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isRetracting || !canRetract) return

    setIsRetracting(true)
    try {
      const result = await apiPost<{ alreadyRevoked: boolean }>(
        "/api/attestation/retract",
        { attestationId: attestation.id }
      )

      if (result.ok) {
        onRetract?.(attestation.id)
      }
    } finally {
      setIsRetracting(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <Link href={href} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
          <ProfileAvatar type="user" src={otherUser.avatarUrl} name={displayName} size="sm" />
          <div className="min-w-0">
            <div className="truncate font-medium">{displayName}</div>
            {otherUser.handle && (
              <div className="truncate text-xs text-muted-foreground">@{otherUser.handle}</div>
            )}
          </div>
        </Link>
        <ArrowUpRight className="size-3 shrink-0 text-amber-500" />
        <AttestationBadge type={attestation.type} />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {canRetract && (
          <Button
            variant="destructive"
            size="xs"
            onClick={handleRetract}
            disabled={isRetracting}
            className="gap-1"
          >
            <Undo2 className="size-3" />
            {isRetracting ? "…" : "Retract"}
          </Button>
        )}
        {isMinted ? (
          <Badge variant="positive" className="gap-1">
            <Link2 className="size-3" />
            Published
          </Badge>
        ) : (
          <Badge variant="secondary">Pending</Badge>
        )}
        <span className="text-xs text-muted-foreground">
          {formatRelativeTime(attestation.createdAt)}
        </span>
      </div>
    </div>
  )
}

// === LOADING SKELETON ===

function AttestationsSkeleton({ isSelf }: { isSelf: boolean }) {
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

      {/* OnchainBanner skeleton — only for profile owner */}
      {isSelf && (
        <div className="rounded-2xl border border-border/60 bg-gradient-to-b from-card/80 via-card/60 to-primary/5 p-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex flex-col items-center gap-1.5">
              <Skeleton className="h-6 w-72" />
              <Skeleton className="h-4 w-36" />
            </div>
            <Skeleton className="h-4 w-96 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="mt-6 flex flex-col items-center gap-4 border-t border-border/40 pt-4">
            <Skeleton className="h-9 w-24 rounded-lg" />
          </div>
        </div>
      )}

      {/* List skeleton */}
      <Card>
        <CardHeader>
          <CardTitle><Skeleton className="h-5 w-32" /></CardTitle>
          <CardDescription><Skeleton className="h-4 w-64" /></CardDescription>
        </CardHeader>
        <CardContent>
          <ListFeedSkeleton rows={6} />
        </CardContent>
      </Card>
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
    <Card aria-label="Attestation filters" className="bg-card/30 border-border/30">
      <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Search</div>
          <Input
            placeholder="Name, handle, type…"
            value={filters.q}
            onChange={(e) => onFiltersChange({ q: e.target.value })}
            aria-label="Search attestations"
          />
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Type</div>
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

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Status</div>
          <Select
            value={filters.status || null}
            onValueChange={(v) => onFiltersChange({ status: (v ?? "") as FilterState["status"] })}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string | null) => v === "published" ? "Published" : v === "pending" ? "Pending" : "All"}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={null as unknown as string}>All</SelectItem>
                <SelectItem value="published">Published</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {active && (
          <>
            <Separator className="sm:col-span-2 lg:col-span-3" />
            <div className="flex items-center justify-center gap-2 sm:col-span-2 lg:col-span-3">
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

// === MAIN COMPONENT ===

export default function AttestationsPage() {
  const params = useParams<{ handle: string }>()
  const { data: session } = useSession()
  const handle = params.handle?.trim() || ""

  const viewerId = session?.user?.id ?? null
  const isSelf = session?.user?.handle === handle
  const profile = useUserProfile(handle)

  const displayName = profile?.name?.trim() || `@${handle}`
  const avatarSrc = profile?.avatarUrl || profile?.image || ""

  // Get lastChangedAt from queue context to trigger refetch when cart saves
  const { lastChangedAt } = useAttestationQueue()

  const [cursor, setCursor] = React.useState<string | null>(null)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)
  const [localItems, setLocalItems] = React.useState<Attestation[]>([])

  const [mintingIds, setMintingIds] = React.useState<Set<string>>(new Set())

  const [filters, setFilters] = React.useState<FilterState>({
    q: "",
    type: "",
    status: "",
  })

  // Reset cursor when cart saves to force fresh fetch from page 1
  React.useEffect(() => {
    if (lastChangedAt > 0) {
      setCursor(null)
    }
  }, [lastChangedAt])

  const { items: fetchedItems, nextCursor, loading, filtering, loadingMore, error } = useAttestationsData(
    handle,
    filters,
    cursor,
    lastChangedAt,
  )

  // Sync fetched items to local state (allows optimistic removal on retract)
  const fetchedIds = React.useMemo(
    () => fetchedItems.map((a) => a.id).sort().join(","),
    [fetchedItems]
  )
  const prevFetchedIds = React.useRef(fetchedIds)

  React.useEffect(() => {
    if (fetchedIds !== prevFetchedIds.current || localItems.length === 0) {
      setLocalItems(fetchedItems)
      prevFetchedIds.current = fetchedIds
    }
  }, [fetchedItems, fetchedIds, localItems.length])

  const handleRetract = React.useCallback((attestationId: string) => {
    setLocalItems((prev) => prev.filter((a) => a.id !== attestationId))
  }, [])

  // Mint function — calls API to persist state, will be extended with Intuition SDK later
  const handleMint = React.useCallback(async (id: string, options?: { silent?: boolean }) => {
    setMintingIds((prev) => new Set(prev).add(id))

    try {
      // TODO: When Intuition integration is ready:
      // 1. Call Intuition SDK to mint onchain
      // 2. Get txHash and onchainId from the response
      // 3. Pass them to the API below

      // For now, simulate the blockchain call delay
      await new Promise((resolve) => setTimeout(resolve, 1000))

      const result = await apiPost<{
        attestation: { id: string; mintedAt: string };
        alreadyMinted: boolean;
      }>("/api/attestation/mint", {
        attestationId: id,
      })

      if (result.ok) {
        const mintedAt = result.value.attestation.mintedAt
        setLocalItems((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, mintedAt } : a
          )
        )
        if (!options?.silent) {
          sounds.mint()
        }
      } else {
        console.error("[Mint] Failed to mint attestation:", result.error)
        if (!options?.silent) {
          sounds.error()
        }
      }
    } catch (err) {
      console.error("[Mint] Error minting attestation:", err)
      if (!options?.silent) {
        sounds.error()
      }
    } finally {
      setMintingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const handleMintAll = React.useCallback(async () => {
    const unmintedIds = localItems
      .filter((a) => !a.mintedAt && a.fromUser.id === viewerId)
      .map((a) => a.id)

    if (unmintedIds.length === 0) return

    const loopControl = await sounds.loopMintAll()

    try {
      for (const id of unmintedIds) {
        await handleMint(id, { silent: true })
      }
    } finally {
      loopControl.stop()
      sounds.mint()
    }
  }, [localItems, viewerId, handleMint])

  const activeFilters = hasActiveFilters(filters)
  const items = localItems

  // Calculate minting stats
  const [mintStats, setMintStats] = React.useState({ totalCount: 0, mintedCount: 0 })

  React.useEffect(() => {
    const total = localItems.filter((a) => a.fromUser.id === viewerId).length
    const minted = localItems.filter((a) => a.fromUser.id === viewerId && a.mintedAt).length

    if (total > 0 || mintStats.totalCount === 0) {
      setMintStats({ totalCount: total, mintedCount: minted })
    }
  }, [localItems, viewerId, mintStats.totalCount])

  const { totalCount, mintedCount } = mintStats
  const isMinting = mintingIds.size > 0

  // Reset paging when filters change
  React.useEffect(() => {
    setCursor(null)
  }, [filters.q, filters.type, filters.status])

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters({ q: "", type: "", status: "" })
  }

  if (!handle) return null

  if (loading) return <AttestationsSkeleton isSelf={isSelf} />

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col mt-24 gap-6 pb-40">
      <PageHeader
        leading={
          <ProfileAvatar type="user" src={avatarSrc} name={displayName} className="h-12 w-12" />
        }
        title="Attestations"
        description={`@${handle}`}
        actionsAsFormActions={false}
        actions={
          <PageToolbar
            actions={[
              { label: "Filters", active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) },
            ]}
            nav={[
              { label: "Profile", href: userPath(handle) },
              { label: "Attestations", href: userAttestationsPath(handle) },
              { label: "Activity", href: userActivityPath(handle) },
              ...(isSelf ? [{ label: "Settings", href: userSettingsPath(handle) }] : []),
            ]}
          />
        }
      />

      {/* Onchain Banner — only show for profile owner */}
      {isSelf && totalCount > 0 && (
        <OnchainBanner
          totalCount={totalCount}
          mintedCount={mintedCount}
          isMinting={isMinting}
          onMintAll={handleMintAll}
        />
      )}

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
        {loading || filtering ? "Loading attestations..." : `${items.length} attestations loaded`}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attestations</CardTitle>
          <CardDescription>Attestations given by this user.</CardDescription>
        </CardHeader>
        <CardContent>
          {filtering ? (
            <ListFeedSkeleton rows={6} />
          ) : (
            <InfiniteScroll
              onLoadMore={() => setCursor(nextCursor)}
              hasMore={!!nextCursor}
              isLoading={loadingMore}
            >
              <ListFeed<Attestation>
                items={items}
                keyExtractor={(a) => a.id}
                renderItem={(a) => (
                  <AttestationRow
                    attestation={a}
                    viewerId={viewerId}
                    onRetract={handleRetract}
                  />
                )}
                loading={false}
                loadingMore={loadingMore}
                emptyMessage={activeFilters ? "No attestations match your filters." : "No attestations yet."}
                renderEmpty={activeFilters ? () => (
                  <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
                    <p>No attestations found.</p>
                    <Button
                      type="button"
                      variant="link"
                      onClick={handleClearAll}
                      className="mt-2"
                    >
                      Clear all filters
                    </Button>
                  </div>
                ) : undefined}
              />
            </InfiniteScroll>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
