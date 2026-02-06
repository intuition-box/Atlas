"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { ArrowDownLeft, ArrowUpRight, Filter, Undo2, Link2, Check, Loader2, SquareCheck, Square } from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet, apiPost } from "@/lib/api/client"
import { sounds } from "@/lib/sounds"
import { ROUTES, userPath } from "@/lib/routes"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InfiniteScroll } from "@/components/ui/infinite-scroll"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { PageHeader } from "@/components/common/page-header"
import { Spinner } from "@/components/ui/spinner"
import { Checkbox } from "@/components/ui/checkbox"
import { OnchainBanner } from "@/components/attestation/onchain-banner"
import { SelectionActionBar } from "@/components/attestation/selection-action-bar"
import { ATTESTATION_TYPES, ATTESTATION_TYPE_LIST, type AttestationType } from "@/config/attestations"

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
  direction: "received" | "given" | "all"
}

// === UTILITY FUNCTIONS ===

function initials(name: string | null): string {
  if (!name) return "?"
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return "?"
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase()
}

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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value)

  React.useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(t)
  }, [value, delayMs])

  return debounced
}

function useAttestationsData(
  handle: string,
  filters: FilterState,
  cursor: string | null
) {
  const router = useRouter()
  const [items, setItems] = React.useState<Attestation[]>([])
  const [nextCursor, setNextCursor] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const debouncedQ = useDebouncedValue(filters.q, 300)

  // Build query params based on direction
  const queryParams = React.useMemo(() => {
    const params: Record<string, string> = {
      take: String(PAGE_SIZE),
    }

    if (filters.direction === "received") {
      params.toHandle = handle
    } else if (filters.direction === "given") {
      params.fromHandle = handle
    } else {
      // "all" - we'll need to make two requests or just default to received
      params.toHandle = handle
    }

    if (filters.type) {
      params.type = filters.type
    }

    if (cursor) {
      params.cursor = cursor
    }

    return params
  }, [handle, filters.direction, filters.type, cursor])

  React.useEffect(() => {
    const ac = new AbortController()

    async function load() {
      setError(null)
      setLoading(cursor === null)
      setLoadingMore(cursor !== null)

      try {
        // For "all" direction, we need to fetch both received and given
        if (filters.direction === "all") {
          const [receivedRes, givenRes] = await Promise.all([
            apiGet<AttestationsResponse>("/api/attestation/list", {
              toHandle: handle,
              take: String(PAGE_SIZE),
              ...(filters.type ? { type: filters.type } : {}),
            }, { signal: ac.signal }),
            apiGet<AttestationsResponse>("/api/attestation/list", {
              fromHandle: handle,
              take: String(PAGE_SIZE),
              ...(filters.type ? { type: filters.type } : {}),
            }, { signal: ac.signal }),
          ])

          if (ac.signal.aborted) return

          const received = receivedRes.ok ? receivedRes.value.attestations : []
          const given = givenRes.ok ? givenRes.value.attestations : []

          // Merge and sort by date
          const merged = [...received, ...given].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )

          setItems((prev) => cursor ? mergeAttestationsUnique(prev, merged) : merged)
          setNextCursor(null) // Pagination is tricky with merged results
          setLoading(false)
          setLoadingMore(false)
          return
        }

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
          setLoadingMore(false)
          return
        }

        const attestations = res.value.attestations
        setItems((prev) => cursor ? mergeAttestationsUnique(prev, attestations) : attestations)
        setNextCursor(res.value.nextCursor)
        setLoading(false)
        setLoadingMore(false)
      } catch {
        if (!ac.signal.aborted) {
          setError("An unexpected error occurred.")
          setLoading(false)
          setLoadingMore(false)
        }
      }
    }

    void load()

    return () => {
      ac.abort()
    }
  }, [router, queryParams, cursor, handle, filters.direction, filters.type])

  // Filter by search query client-side
  const filteredItems = React.useMemo(() => {
    if (!debouncedQ) return items

    const q = debouncedQ.toLowerCase()
    return items.filter((a) => {
      const fromName = a.fromUser.name?.toLowerCase() ?? ""
      const fromHandle = a.fromUser.handle?.toLowerCase() ?? ""
      const toName = a.toUser.name?.toLowerCase() ?? ""
      const toHandle = a.toUser.handle?.toLowerCase() ?? ""
      const typeLabel = ATTESTATION_TYPES[a.type].label.toLowerCase()

      return (
        fromName.includes(q) ||
        fromHandle.includes(q) ||
        toName.includes(q) ||
        toHandle.includes(q) ||
        typeLabel.includes(q)
      )
    })
  }, [items, debouncedQ])

  return { items: filteredItems, nextCursor, loading, loadingMore, error }
}

// === SUB-COMPONENTS ===

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-4xl bg-muted-foreground/10 px-2 py-1 text-xs font-medium">
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          className="-mr-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          onClick={onRemove}
          aria-label="Remove filter"
        >
          ×
        </button>
      )}
    </span>
  )
}

function AttestationCard({
  attestation,
  currentHandle,
  viewerId,
  isSelected,
  isMinting,
  onRetract,
  onSelect,
  onMint,
}: {
  attestation: Attestation
  currentHandle: string
  viewerId: string | null
  isSelected: boolean
  isMinting: boolean
  onRetract?: (id: string) => void
  onSelect?: (id: string, selected: boolean) => void
  onMint?: (id: string) => void
}) {
  const [isRetracting, setIsRetracting] = React.useState(false)
  const isReceived = attestation.toUser.handle === currentHandle
  const otherUser = isReceived ? attestation.fromUser : attestation.toUser
  const displayName = otherUser.name?.trim() || `@${otherUser.handle}`
  const href = userPath(otherUser.handle ?? otherUser.id)
  const typeInfo = ATTESTATION_TYPES[attestation.type]
  const isMinted = !!attestation.mintedAt

  // Can only retract attestations you gave
  const canRetract = !isReceived && viewerId === attestation.fromUser.id
  // Can only mint attestations you gave that aren't minted
  const canMint = !isReceived && viewerId === attestation.fromUser.id && !isMinted

  const handleRetract = async () => {
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
    <div
      className={cn(
        "relative rounded-2xl border bg-card/30 p-4 transition-colors hover:bg-card/50",
        isSelected ? "border-primary/50 bg-primary/5" : "border-border/60"
      )}
    >
      {/* Selection checkbox (only for mintable attestations) */}
      {canMint && (
        <div className="absolute left-3 top-3">
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelect?.(attestation.id, !!checked)}
            className="size-4"
          />
        </div>
      )}

      <div className={cn("flex items-start gap-3", canMint && "ml-6")}>
        <Link href={href}>
          <Avatar className="h-10 w-10">
            <AvatarImage src={otherUser.avatarUrl ?? undefined} alt={displayName} />
            <AvatarFallback>{initials(otherUser.name)}</AvatarFallback>
          </Avatar>
        </Link>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <Link href={href} className="hover:underline">
                <span className="truncate text-sm font-medium">{displayName}</span>
              </Link>
              {otherUser.handle && (
                <span className="ml-1 text-xs text-muted-foreground">@{otherUser.handle}</span>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {isMinted && (
                <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary border-primary/20">
                  <Link2 className="size-3" />
                  Onchain
                </Badge>
              )}
              {isReceived ? (
                <Badge variant="secondary" className="gap-1">
                  <ArrowDownLeft className="size-3" />
                  Received
                </Badge>
              ) : (
                <Badge variant="outline" className="gap-1">
                  <ArrowUpRight className="size-3" />
                  Given
                </Badge>
              )}
            </div>
          </div>

          {otherUser.headline && (
            <div className="text-xs text-foreground/80 line-clamp-1">{otherUser.headline}</div>
          )}

          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default" className="bg-primary/10 text-primary hover:bg-primary/10">
                {typeInfo.label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {formatRelativeTime(attestation.createdAt)}
              </span>
            </div>

            <div className="flex items-center gap-1">
              {canMint && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onMint?.(attestation.id)}
                  disabled={isMinting}
                  className="text-primary hover:text-primary hover:bg-primary/10"
                >
                  {isMinting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <>
                      <Link2 className="size-3 mr-1" />
                      Mint
                    </>
                  )}
                </Button>
              )}
              {canRetract && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleRetract}
                  disabled={isRetracting}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Undo2 className="size-3 mr-1" />
                  {isRetracting ? "..." : "Retract"}
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function AttestationRow({
  attestation,
  currentHandle,
  viewerId,
  isSelected,
  isMinting,
  onRetract,
  onSelect,
  onMint,
}: {
  attestation: Attestation
  currentHandle: string
  viewerId: string | null
  isSelected: boolean
  isMinting: boolean
  onRetract?: (id: string) => void
  onSelect?: (id: string, selected: boolean) => void
  onMint?: (id: string) => void
}) {
  const [isRetracting, setIsRetracting] = React.useState(false)
  const isReceived = attestation.toUser.handle === currentHandle
  const otherUser = isReceived ? attestation.fromUser : attestation.toUser
  const canRetract = !isReceived && viewerId === attestation.fromUser.id
  const isMinted = !!attestation.mintedAt
  const canMint = !isReceived && viewerId === attestation.fromUser.id && !isMinted

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
  const displayName = otherUser.name?.trim() || `@${otherUser.handle}`
  const href = userPath(otherUser.handle ?? otherUser.id)
  const typeInfo = ATTESTATION_TYPES[attestation.type]

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.5fr)] gap-3 px-4 py-3 text-sm transition-colors hover:bg-card/50",
        isSelected && "bg-primary/5"
      )}
    >
      {/* Selection checkbox */}
      <div className="flex items-center">
        {canMint ? (
          <Checkbox
            checked={isSelected}
            onCheckedChange={(checked) => onSelect?.(attestation.id, !!checked)}
            className="size-4"
          />
        ) : (
          <div className="size-4" />
        )}
      </div>

      <Link href={href} className="flex min-w-0 items-center gap-3">
        <Avatar className="h-8 w-8">
          <AvatarImage src={otherUser.avatarUrl ?? undefined} alt={displayName} />
          <AvatarFallback>{initials(otherUser.name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="truncate font-medium hover:underline">{displayName}</div>
          {otherUser.handle && (
            <div className="truncate text-xs text-muted-foreground">@{otherUser.handle}</div>
          )}
        </div>
      </Link>

      <div className="flex items-center">
        <Badge variant="default" className="bg-primary/10 text-primary hover:bg-primary/10">
          {typeInfo.label}
        </Badge>
      </div>

      <div className="flex items-center">
        {isReceived ? (
          <Badge variant="secondary" className="gap-1">
            <ArrowDownLeft className="size-3" />
            Received
          </Badge>
        ) : (
          <Badge variant="outline" className="gap-1">
            <ArrowUpRight className="size-3" />
            Given
          </Badge>
        )}
      </div>

      <div className="flex items-center">
        {isMinted ? (
          <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary border-primary/20">
            <Link2 className="size-3" />
            Onchain
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">Off-chain</span>
        )}
      </div>

      <div className="flex items-center text-xs text-muted-foreground">
        {formatRelativeTime(attestation.createdAt)}
      </div>

      <div className="flex items-center justify-end gap-1">
        {canMint && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => onMint?.(attestation.id)}
            disabled={isMinting}
            className="text-primary hover:text-primary hover:bg-primary/10"
          >
            {isMinting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Link2 className="size-3" />
            )}
          </Button>
        )}
        {canRetract && (
          <Button
            variant="ghost"
            size="xs"
            onClick={handleRetract}
            disabled={isRetracting}
            className="text-muted-foreground hover:text-destructive"
          >
            <Undo2 className="size-3" />
          </Button>
        )}
      </div>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20" aria-busy="true">
      <Spinner className="size-8 text-muted-foreground" />
    </div>
  )
}

function ActiveFiltersBar({
  filters,
  count,
  hasMorePages,
  onRemoveType,
}: {
  filters: FilterState
  count: number
  hasMorePages: boolean
  onRemoveType: () => void
}) {
  return (
    <div className="-mt-2 flex flex-wrap items-center gap-2">
      <Badge variant="secondary">
        {count}
        {hasMorePages ? "+" : ""} attestations
      </Badge>
      {filters.type && (
        <Chip onRemove={onRemoveType}>
          Type: {ATTESTATION_TYPES[filters.type].label}
        </Chip>
      )}
    </div>
  )
}

function FiltersPanel({
  filters,
  onFiltersChange,
}: {
  filters: FilterState
  onFiltersChange: (updates: Partial<FilterState>) => void
}) {
  return (
    <section className="rounded-2xl border border-border/60 bg-card/30 p-4" aria-label="Attestation filters">
      <div className="grid gap-4 md:grid-cols-3">
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
          <select
            value={filters.type}
            onChange={(e) => onFiltersChange({ type: e.target.value as AttestationType | "" })}
            className="h-9 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="">All types</option>
            {ATTESTATION_TYPE_LIST.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-xs font-medium text-foreground/70">Direction</div>
          <select
            value={filters.direction}
            onChange={(e) => onFiltersChange({ direction: e.target.value as FilterState["direction"] })}
            className="h-9 rounded-xl border border-border bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <option value="all">All</option>
            <option value="received">Received</option>
            <option value="given">Given</option>
          </select>
        </div>
      </div>
    </section>
  )
}

function AttestationsGrid({
  items,
  view,
  currentHandle,
  viewerId,
  selectedIds,
  mintingIds,
  onRetract,
  onSelect,
  onMint,
}: {
  items: Attestation[]
  view: "cards" | "list"
  currentHandle: string
  viewerId: string | null
  selectedIds: Set<string>
  mintingIds: Set<string>
  onRetract?: (id: string) => void
  onSelect?: (id: string, selected: boolean) => void
  onMint?: (id: string) => void
}) {
  if (view === "cards") {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <AttestationCard
            key={a.id}
            attestation={a}
            currentHandle={currentHandle}
            viewerId={viewerId}
            isSelected={selectedIds.has(a.id)}
            isMinting={mintingIds.has(a.id)}
            onRetract={onRetract}
            onSelect={onSelect}
            onMint={onMint}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/30 overflow-hidden">
      <div className="grid grid-cols-[auto_minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.5fr)] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium text-foreground/70">
        <div className="w-4"></div>
        <div>User</div>
        <div>Type</div>
        <div>Direction</div>
        <div>Status</div>
        <div>Date</div>
        <div></div>
      </div>

      {items.map((a) => (
        <AttestationRow
          key={a.id}
          attestation={a}
          currentHandle={currentHandle}
          viewerId={viewerId}
          isSelected={selectedIds.has(a.id)}
          isMinting={mintingIds.has(a.id)}
          onRetract={onRetract}
          onSelect={onSelect}
          onMint={onMint}
        />
      ))}
    </div>
  )
}

function EmptyState({ hasFilters, onClearFilters }: { hasFilters: boolean; onClearFilters: () => void }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/30 px-4 py-10 text-center text-sm text-muted-foreground">
      <p>No attestations found.</p>
      {hasFilters && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-2 text-primary hover:underline"
        >
          Clear all filters
        </button>
      )}
    </div>
  )
}

// === MAIN COMPONENT ===

export default function AttestationsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const { data: session } = useSession()
  const handle = params.handle?.trim() || ""

  const viewerId = session?.user?.id ?? null

  const [view, setView] = React.useState<"cards" | "list">("cards")
  const [cursor, setCursor] = React.useState<string | null>(null)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)
  const [localItems, setLocalItems] = React.useState<Attestation[]>([])

  // Selection and minting state
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  const [mintingIds, setMintingIds] = React.useState<Set<string>>(new Set())

  const [filters, setFilters] = React.useState<FilterState>({
    q: "",
    type: "",
    direction: "all",
  })

  const { items: fetchedItems, nextCursor, loading, loadingMore, error } = useAttestationsData(
    handle,
    filters,
    cursor
  )

  // Sync fetched items to local state (allows optimistic removal on retract)
  // Only update if the IDs have changed to avoid overwriting local mint state
  const fetchedIds = React.useMemo(
    () => fetchedItems.map((a) => a.id).sort().join(","),
    [fetchedItems]
  )
  const prevFetchedIds = React.useRef(fetchedIds)

  React.useEffect(() => {
    // Only sync if the actual items changed (new fetch), not just re-renders
    if (fetchedIds !== prevFetchedIds.current || localItems.length === 0) {
      setLocalItems(fetchedItems)
      prevFetchedIds.current = fetchedIds
    }
  }, [fetchedItems, fetchedIds, localItems.length])

  const handleRetract = React.useCallback((attestationId: string) => {
    setLocalItems((prev) => prev.filter((a) => a.id !== attestationId))
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.delete(attestationId)
      return next
    })
  }, [])

  const handleSelect = React.useCallback((id: string, selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (selected) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])

  const handleClearSelection = React.useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  // Mint function - calls API to persist state, will be extended with Intuition SDK later
  const handleMint = React.useCallback(async (id: string) => {
    setMintingIds((prev) => new Set(prev).add(id))

    try {
      // TODO: When Intuition integration is ready:
      // 1. Call Intuition SDK to mint onchain
      // 2. Get txHash and onchainId from the response
      // 3. Pass them to the API below

      // For now, simulate the blockchain call delay
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Persist mint state to database
      const result = await apiPost<{
        attestation: { id: string; mintedAt: string };
        alreadyMinted: boolean;
      }>("/api/attestation/mint", {
        attestationId: id,
        // txHash: "0x...", // Will come from Intuition SDK
        // onchainId: "...", // Will come from Intuition SDK
      })

      if (result.ok) {
        // Update local state to mark as minted
        const mintedAt = result.value.attestation.mintedAt
        setLocalItems((prev) =>
          prev.map((a) =>
            a.id === id ? { ...a, mintedAt } : a
          )
        )
        sounds.play("/sounds/mint.mp3")
      } else {
        console.error("[Mint] Failed to mint attestation:", result.error)
        sounds.play("/sounds/select.mp3", { pitch: 0.8 })
      }
    } catch (err) {
      console.error("[Mint] Error minting attestation:", err)
      sounds.play("/sounds/select.mp3", { pitch: 0.8 })
    } finally {
      setMintingIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const handleMintSelected = React.useCallback(async () => {
    const ids = Array.from(selectedIds)
    for (const id of ids) {
      await handleMint(id)
    }
  }, [selectedIds, handleMint])

  const handleMintAll = React.useCallback(async () => {
    // Get all unminted attestations that the viewer gave
    const unmintedIds = localItems
      .filter((a) => !a.mintedAt && a.fromUser.id === viewerId)
      .map((a) => a.id)

    for (const id of unmintedIds) {
      await handleMint(id)
    }
  }, [localItems, viewerId, handleMint])

  const activeFilters = hasActiveFilters(filters)
  const items = localItems

  // Calculate minting stats
  const totalCount = items.filter((a) => a.fromUser.id === viewerId).length
  const mintedCount = items.filter((a) => a.fromUser.id === viewerId && a.mintedAt).length
  const isMinting = mintingIds.size > 0

  // Reset paging when filters change
  React.useEffect(() => {
    setCursor(null)
  }, [filters.q, filters.type, filters.direction])

  function handleFiltersChange(updates: Partial<FilterState>) {
    setFilters((prev) => ({ ...prev, ...updates }))
  }

  function handleClearAll() {
    setFilters({
      q: "",
      type: "",
      direction: "all",
    })
  }

  if (!handle) return null

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-10">
      <PageHeader
        title="Attestations"
        description={`@${handle}`}
        actions={
          <div className="flex items-center gap-2">
            <Tabs className="gap-0" value={view} onValueChange={(v) => setView(v === "list" ? "list" : "cards")}>
              <TabsList>
                <TabsTrigger value="cards">Cards</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
              </TabsList>
              <TabsContent value="cards" />
              <TabsContent value="list" />
            </Tabs>

            <Button type="button" variant="secondary" onClick={() => setIsFiltersOpen((v) => !v)}>
              <Filter className="size-4 mr-1" />
              {isFiltersOpen ? "Hide filters" : "Filters"}
            </Button>

            <Button type="button" variant="ghost" onClick={() => router.refresh()}>
              Refresh
            </Button>

            {activeFilters && (
              <Button type="button" variant="ghost" onClick={handleClearAll}>
                Reset
              </Button>
            )}
          </div>
        }
      />

      {/* Onchain Banner - only show if viewer is viewing their own attestations */}
      {viewerId && totalCount > 0 && (
        <OnchainBanner
          totalCount={totalCount}
          mintedCount={mintedCount}
          selectedIds={selectedIds}
          isMinting={isMinting}
          onMintAll={handleMintAll}
          onMintSelected={handleMintSelected}
        />
      )}

      <ActiveFiltersBar
        filters={filters}
        count={items.length}
        hasMorePages={!!nextCursor}
        onRemoveType={() => handleFiltersChange({ type: "" })}
      />

      {isFiltersOpen && (
        <FiltersPanel
          filters={filters}
          onFiltersChange={handleFiltersChange}
        />
      )}

      {error && (
        <div
          className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loading ? "Loading attestations..." : `${items.length} attestations loaded`}
      </div>

      {loading ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState hasFilters={activeFilters} onClearFilters={handleClearAll} />
      ) : (
        <InfiniteScroll
          onLoadMore={() => setCursor(nextCursor)}
          hasMore={!!nextCursor}
          isLoading={loadingMore}
        >
          <AttestationsGrid
            items={items}
            view={view}
            currentHandle={handle}
            viewerId={viewerId}
            selectedIds={selectedIds}
            mintingIds={mintingIds}
            onRetract={handleRetract}
            onSelect={handleSelect}
            onMint={handleMint}
          />
        </InfiniteScroll>
      )}

      {/* Floating selection action bar */}
      <SelectionActionBar
        selectedCount={selectedIds.size}
        isMinting={isMinting}
        onMintSelected={handleMintSelected}
        onClearSelection={handleClearSelection}
      />
    </main>
  )
}
