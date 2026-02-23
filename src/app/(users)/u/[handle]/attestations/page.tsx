"use client"

import * as React from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import {
  ArrowDownLeft,
  ArrowUpRight,
  LayoutGrid,
  Link2,
  List,
  Loader2,
  Undo2,
  X,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { apiGet, apiPost } from "@/lib/api/client"
import { sounds } from "@/lib/sounds"
import { ROUTES, userPath, userAttestationsPath, userSettingsPath } from "@/lib/routes"
import { ATTESTATION_TYPES, ATTESTATION_TYPE_LIST, type AttestationType } from "@/lib/attestations/definitions"
import { AttestationBadge } from "@/components/attestation/badge"
import { OnchainBanner } from "@/components/attestation/onchain-banner"
import { useAttestationQueue } from "@/components/attestation/queue-provider"

import { PageHeader } from "@/components/common/page-header"
import { PageHeaderMenu } from "@/components/common/page-header-menu"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

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
  direction: "received" | "given" | ""
}

// === UTILITY FUNCTIONS ===

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
  return Boolean(filters.q || filters.type || filters.direction)
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

function useAttestationsData(
  handle: string,
  filters: FilterState,
  cursor: string | null,
  /** Timestamp of last cart save - triggers refetch when changed */
  lastSavedAt: number = 0,
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
      // "" (all) - we'll need to make two requests or just default to received
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
      if (cursor !== null) {
        setLoadingMore(true)
      } else if (hasLoadedOnce.current) {
        setFiltering(true)
      } else {
        setLoading(true)
      }

      try {
        // For "" (all) direction, we need to fetch both received and given
        if (!filters.direction) {
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
          hasLoadedOnce.current = true
          setLoading(false)
          setFiltering(false)
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
  }, [router, queryParams, cursor, handle, filters.direction, filters.type, lastSavedAt, refreshKey])

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

  return { items: filteredItems, nextCursor, loading, filtering, loadingMore, error }
}

// === SUB-COMPONENTS ===

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
  const isMinted = !!attestation.mintedAt

  const canRetract = !isReceived && viewerId === attestation.fromUser.id
  const canMint = !isReceived && viewerId === attestation.fromUser.id && !isMinted

  const handleRetract = async () => {
    if (isRetracting || !canRetract) return
    setIsRetracting(true)
    try {
      const result = await apiPost<{ alreadyRevoked: boolean }>(
        "/api/attestation/retract",
        { attestationId: attestation.id }
      )
      if (result.ok) onRetract?.(attestation.id)
    } finally {
      setIsRetracting(false)
    }
  }

  const handleCardClick = () => {
    if (canMint) onSelect?.(attestation.id, !isSelected)
  }

  return (
    <Card
      size="sm"
      className={cn(
        "transition-colors",
        canMint && "cursor-pointer",
        isSelected ? "ring-primary/50 bg-primary/5" : "ring-border/60",
      )}
      onClick={handleCardClick}
    >
      {/* Header: avatar + name + handle on left, onchain/offchain badge on right */}
      <CardHeader className="flex-row items-center gap-3">
        <div className="flex items-center gap-3">
          <Link href={href} onClick={(e) => e.stopPropagation()}>
            <ProfileAvatar type="user" src={otherUser.avatarUrl} name={displayName} className="size-9" />
          </Link>
          <div className="min-w-0">
            <Link href={href} className="hover:underline" onClick={(e) => e.stopPropagation()}>
              <span className="truncate text-sm font-medium">{displayName}</span>
            </Link>
            {otherUser.handle && (
              <div className="truncate text-xs text-muted-foreground">@{otherUser.handle}</div>
            )}
          </div>
        </div>
        <CardAction>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatRelativeTime(attestation.createdAt)}
            </span>
            {isMinted ? (
              <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary border-primary/20">
                <Link2 className="size-3" />
                Onchain
              </Badge>
            ) : (
              <Badge variant="secondary" className="gap-1 bg-violet-500/10 text-violet-500 border-violet-500/20">
                Offchain
              </Badge>
            )}
          </div>
        </CardAction>
      </CardHeader>

      {/* Body: direction, type | buttons */}
      <CardContent className="flex items-center gap-2">
        {isReceived ? (
          <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
            <ArrowDownLeft className="size-3" />
            Received
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 bg-amber-500/10 text-amber-600 border-amber-500/20">
            <ArrowUpRight className="size-3" />
            Given
          </Badge>
        )}
        <AttestationBadge type={attestation.type} />

        {(canRetract || canMint) && (
          <>
            <span className="h-4 w-px bg-border" />
            <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {canRetract && (
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={handleRetract}
                  disabled={isRetracting}
                  className="gap-1"
                >
                  <Undo2 className="size-3" />
                  {isRetracting ? "Retracting…" : "Retract"}
                </Button>
              )}
              {canMint && (
                <Button
                  size="xs"
                  onClick={() => onMint?.(attestation.id)}
                  disabled={isMinting}
                  className="gap-1"
                >
                  {isMinting ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Link2 className="size-3" />
                  )}
                  Mint
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function AttestationCardSkeleton() {
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
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-10" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Skeleton className="h-5 w-18 rounded-full" />
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-4 w-px" />
        <Skeleton className="h-6 w-16 rounded-md" />
        <Skeleton className="h-6 w-14 rounded-md" />
      </CardContent>
    </Card>
  )
}

function AttestationRowSkeleton() {
  return (
    <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.5fr)] gap-3 px-4 py-3">
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
      <div className="flex items-center"><Skeleton className="h-5 w-18 rounded-full" /></div>
      <div className="flex items-center"><Skeleton className="h-3 w-12" /></div>
      <div className="flex items-center"><Skeleton className="h-5 w-16 rounded-full" /></div>
      <div className="flex items-center justify-end gap-2">
        <Skeleton className="size-6 rounded" />
        <Skeleton className="size-6 rounded" />
      </div>
    </div>
  )
}

function AttestationsGridSkeleton({ view }: { view: "cards" | "list" }) {
  if (view === "cards") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <AttestationCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-border/60 bg-card/30 overflow-hidden">
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.5fr)] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium text-foreground/70">
        <div>User</div>
        <div>Direction</div>
        <div>Type</div>
        <div>Date</div>
        <div>Status</div>
        <div />
      </div>
      {Array.from({ length: 6 }, (_, i) => (
        <AttestationRowSkeleton key={i} />
      ))}
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

  const handleRowClick = () => {
    if (canMint) onSelect?.(attestation.id, !isSelected)
  }

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.5fr)] gap-3 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted",
        canMint && "cursor-pointer",
        isSelected && "bg-primary/5"
      )}
      onClick={handleRowClick}
    >
      <div className="flex items-center min-w-0">
        <Link href={href} className="inline-flex min-w-0 items-center gap-3 rounded-md px-1.5 py-1 -mx-1.5 -my-1 transition-colors hover:text-primary" onClick={(e) => e.stopPropagation()}>
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
        {isReceived ? (
          <Badge variant="secondary" className="gap-1 bg-emerald-500/10 text-emerald-500 border-emerald-500/20">
            <ArrowDownLeft className="size-3" />
            Received
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 bg-amber-500/10 text-amber-600 border-amber-500/20">
            <ArrowUpRight className="size-3" />
            Given
          </Badge>
        )}
      </div>

      <div className="flex items-center">
        <AttestationBadge type={attestation.type} />
      </div>

      <div className="flex items-center text-xs text-muted-foreground">
        {formatRelativeTime(attestation.createdAt)}
      </div>

      <div className="flex items-center">
        {isMinted ? (
          <Badge variant="secondary" className="gap-1 bg-primary/10 text-primary border-primary/20">
            Onchain
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1 bg-violet-500/10 text-violet-500 border-violet-500/20">
            Offchain
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
        {canRetract && (
          <Button
            variant="destructive"
            size="xs"
            onClick={handleRetract}
            disabled={isRetracting}
            className="gap-1"
          >
            <Undo2 className="size-3" />
          </Button>
        )}
        {canMint && (
          <Button
            variant="default"
            size="xs"
            onClick={() => onMint?.(attestation.id)}
            disabled={isMinting}
            className="gap-1"
          >
            {isMinting ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Link2 className="size-3" />
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

// === LOADING SKELETON (matches settings page pattern) ===

function AttestationsSkeleton() {
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
          <Skeleton className="h-9 w-24 rounded-lg" />
          <Skeleton className="h-9 w-20 rounded-lg" />
          <Skeleton className="h-9 w-20 rounded-lg" />
          <Skeleton className="h-9 w-9 rounded-lg" />
        </div>
      </div>

      {/* OnchainBanner skeleton */}
      <div className="rounded-2xl border border-border/60 bg-gradient-to-b from-card/80 via-card/60 to-primary/5 p-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-6 w-72" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-4 w-96 max-w-full" />
          <Skeleton className="h-4 w-80 max-w-full" />
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-44" />
            <Skeleton className="h-4 w-36" />
          </div>
        </div>
        <div className="mt-6 flex flex-col items-center gap-4 border-t border-border/40 pt-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </div>

      {/* Attestation cards grid skeleton */}
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <AttestationCardSkeleton key={i} />
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
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="given">Given</SelectItem>
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

// === CONTENT SECTIONS ===

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
      <div className="grid gap-4 sm:grid-cols-2">
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
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.5fr)] gap-3 border-b border-border/60 px-4 py-3 text-xs font-medium text-foreground/70">
        <div>User</div>
        <div>Direction</div>
        <div>Type</div>
        <div>Date</div>
        <div>Status</div>
        <div />
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
    <div className="rounded-lg border border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
      <p>No attestations found.</p>
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

export default function AttestationsPage() {
  const router = useRouter()
  const params = useParams<{ handle: string }>()
  const { data: session } = useSession()
  const handle = params.handle?.trim() || ""

  const viewerId = session?.user?.id ?? null
  const profile = useUserProfile(handle)

  const displayName = profile?.name?.trim() || `@${handle}`
  const avatarSrc = profile?.avatarUrl || profile?.image || ""

  // Get lastSavedAt from queue context to trigger refetch when cart saves
  const { lastSavedAt } = useAttestationQueue()

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
    direction: "",
  })

  // Reset cursor when cart saves to force fresh fetch from page 1
  React.useEffect(() => {
    if (lastSavedAt > 0) {
      setCursor(null)
    }
  }, [lastSavedAt])

  const { items: fetchedItems, nextCursor, loading, filtering, loadingMore, error } = useAttestationsData(
    handle,
    filters,
    cursor,
    lastSavedAt,
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
  const handleMint = React.useCallback(async (id: string, options?: { silent?: boolean }) => {
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
      setSelectedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    }
  }, [])

  const handleMintSelected = React.useCallback(async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return

    // Start looping mintAll sound while minting batch
    const loopControl = await sounds.loopMintAll()

    try {
      for (const id of ids) {
        await handleMint(id, { silent: true })
      }
    } finally {
      // Stop loop and play completion sound once
      loopControl.stop()
      sounds.mint()
    }
  }, [selectedIds, handleMint])

  const handleMintAll = React.useCallback(async () => {
    // Get all unminted attestations that the viewer gave
    const unmintedIds = localItems
      .filter((a) => !a.mintedAt && a.fromUser.id === viewerId)
      .map((a) => a.id)

    if (unmintedIds.length === 0) return

    // Start looping mintAll sound while minting batch
    const loopControl = await sounds.loopMintAll()

    try {
      for (const id of unmintedIds) {
        await handleMint(id, { silent: true })
      }
    } finally {
      // Stop loop and play completion sound once
      loopControl.stop()
      sounds.mint()
    }
  }, [localItems, viewerId, handleMint])

  const activeFilters = hasActiveFilters(filters)
  const items = localItems

  // Calculate minting stats — persisted across filter changes so the banner
  // stays visible even when direction is "received" (which excludes given attestations)
  const [mintStats, setMintStats] = React.useState({ totalCount: 0, mintedCount: 0 })

  React.useEffect(() => {
    // Only update stats when we have the viewer's given attestations in the list
    // (direction "" meaning all, or "given"), or on the very first load
    if (filters.direction === "received") return

    const total = localItems.filter((a) => a.fromUser.id === viewerId).length
    const minted = localItems.filter((a) => a.fromUser.id === viewerId && a.mintedAt).length

    if (total > 0 || mintStats.totalCount === 0) {
      setMintStats({ totalCount: total, mintedCount: minted })
    }
  }, [localItems, viewerId, filters.direction, mintStats.totalCount])

  // Also update when individual attestations are minted (optimistic local state)
  React.useEffect(() => {
    if (filters.direction === "received") {
      // When on "received", still update mintedCount from localItems that we know about
      const minted = localItems.filter((a) => a.fromUser.id === viewerId && a.mintedAt).length
      if (minted > mintStats.mintedCount) {
        setMintStats((prev) => ({ ...prev, mintedCount: minted }))
      }
    }
  }, [localItems, viewerId, filters.direction, mintStats.mintedCount])

  const { totalCount, mintedCount } = mintStats
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
      direction: "",
    })
  }

  if (!handle) return null

  // Full-page skeleton only on the very first load
  if (loading) return <AttestationsSkeleton />

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
          <div className="flex items-center gap-2">
            <Button type="button" variant={isFiltersOpen ? "default" : "secondary"} onClick={() => setIsFiltersOpen((v) => !v)}>
              Filters
            </Button>
            <Tabs className="gap-0" value={view} onValueChange={(v) => setView(v === "list" ? "list" : "cards")}>
              <TabsList>
                <TabsTrigger value="cards" aria-label="Cards view" className="cursor-pointer px-3 !border-transparent data-active:!bg-primary data-active:!text-primary-foreground"><LayoutGrid className="size-4" /></TabsTrigger>
                <TabsTrigger value="list" aria-label="List view" className="cursor-pointer px-3 !border-transparent data-active:!bg-primary data-active:!text-primary-foreground"><List className="size-4" /></TabsTrigger>
              </TabsList>
              <TabsContent value="cards" />
              <TabsContent value="list" />
            </Tabs>
            <PageHeaderMenu
              items={[
                { label: "Profile", href: userPath(handle) },
                { label: "Settings", href: userSettingsPath(handle) },
              ]}
            />
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
          onClearSelection={handleClearSelection}
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

      <div className="flex flex-col gap-3">
        {filtering ? (
          <AttestationsGridSkeleton view={view} />
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
      </div>
    </div>
  )
}
