"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useAccount, useSwitchChain, useChainId } from "wagmi"
import { useConnectModal } from "@rainbow-me/rainbowkit"
import { ArrowUpRight, Link2, Search, Undo2, Wallet } from "lucide-react"
import type { Address } from "viem"

import { cn } from "@/lib/utils"
import { apiGet, apiPost } from "@/lib/api/client"
import { formatRelativeTime } from "@/lib/format"
import { ROUTES, userPath } from "@/lib/routes"
import { ATTESTATION_TYPES, ATTESTATION_TYPE_LIST, isEndorsementType, getAttributeById, type AttestationType } from "@/lib/attestations/definitions"
import { sounds } from "@/lib/sounds"
import { batchCreateAttestations, withdrawAttestations } from "@/lib/intuition/client"
import { INTUITION_CHAIN, getExplorerTxUrl } from "@/lib/intuition/config"
import type { BatchMintItem, BatchWithdrawItem } from "@/lib/intuition/types"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { useTourTrigger } from "@/hooks/use-tour-trigger"
import { createPublishingTour } from "@/components/tour/tour-definitions"

import { AttestationBadge } from "@/components/attestation/badge"
import { OnchainBanner } from "@/components/attestation/onchain-banner"
import { useAttestationQueue } from "@/components/attestation/queue-provider"
import { ListFeed, ListFeedSkeleton } from "@/components/common/list-feed"
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

import { useUser } from "../user-provider"

// === CONSTANTS ===

const PAGE_SIZE = 50

// === TYPES ===

type AttestationUser = {
  id: string
  handle: string | null
  name: string | null
  avatarUrl: string | null
  headline: string | null
  walletAddress: string | null
}

type Attestation = {
  id: string
  type: AttestationType
  attributeId: string | null
  stance: string | null
  depositAmount: string | null
  confidence: number | null
  createdAt: string
  mintedAt: string | null
  mintTxHash: string | null
  onchainId: string | null
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
      const attrLabel = a.attributeId ? (getAttributeById(a.attributeId)?.label.toLowerCase() ?? "") : ""

      return toName.includes(q) || toHandle.includes(q) || typeLabel.includes(q) || attrLabel.includes(q)
    })
  }, [items, debouncedQ])

  return { items: filteredItems, nextCursor, loading, filtering, loadingMore, error }
}

// === SUB-COMPONENTS ===

function AttestationRow({
  attestation,
  viewerId,
  onRemove,
  onWithdraw,
}: {
  attestation: Attestation
  viewerId: string | null
  onRemove?: (id: string) => void
  onWithdraw?: (id: string, onchainId: string) => Promise<void>
}) {
  const [isRemoving, setIsRemoving] = React.useState(false)
  const [isWithdrawing, setIsWithdrawing] = React.useState(false)
  const otherUser = attestation.toUser
  const canRemove = viewerId === attestation.fromUser.id
  const isMinted = !!attestation.mintedAt
  const hasWallet = Boolean(otherUser.walletAddress)
  const explorerUrl = getExplorerTxUrl(attestation.mintTxHash)
  const displayName = otherUser.name?.trim() || `@${otherUser.handle}`
  const href = userPath(otherUser.handle ?? otherUser.id)
  const isEndorsement = isEndorsementType(attestation.type)
  const attribute = attestation.attributeId ? getAttributeById(attestation.attributeId) : undefined
  const isBusy = isRemoving || isWithdrawing

  /** Remove an unminted (pending) attestation — DB-only soft-delete. */
  const handleRemove = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isBusy || !canRemove || isMinted) return

    setIsRemoving(true)
    try {
      const result = await apiPost<{ alreadyRevoked: boolean }>(
        "/api/attestation/retract",
        { attestationId: attestation.id }
      )

      if (result.ok) {
        onRemove?.(attestation.id)
      }
    } finally {
      setIsRemoving(false)
    }
  }

  /** Withdraw a minted (onchain) attestation — redeems position then soft-deletes. */
  const handleWithdraw = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (isBusy || !canRemove || !isMinted || !attestation.onchainId) return

    setIsWithdrawing(true)
    try {
      await onWithdraw?.(attestation.id, attestation.onchainId)
    } finally {
      setIsWithdrawing(false)
    }
  }

  return (
    <div data-tour="attestation-row" className={cn(
      "flex items-center justify-between gap-3 rounded-lg border border-border/60 p-3",
      !hasWallet && !isMinted && "opacity-50",
    )}>
      <div className="flex items-center gap-2 min-w-0 text-sm">
        <Link href={href} className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
          <ProfileAvatar type="user" src={otherUser.avatarUrl} name={displayName} size="sm" />
          <span className="truncate text-sm font-medium">{displayName}</span>
          {otherUser.handle && (
            <span className="truncate text-xs text-muted-foreground">@{otherUser.handle}</span>
          )}
        </Link>
        <ArrowUpRight className="size-3 shrink-0 text-amber-500" />
        <AttestationBadge type={attestation.type} />
        <Badge
          variant={attestation.stance === "against" ? "destructive" : "positive"}
          className="text-[10px] px-1.5 py-0"
        >
          {attestation.stance === "against" ? "Oppose" : "Support"}
        </Badge>
        {isEndorsement && attribute && (
          <span className="truncate text-xs text-muted-foreground">{attribute.label}</span>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {!hasWallet && !isMinted && (
          <span className="inline-flex items-center gap-1 text-xs text-warning-foreground/70">
            <Wallet className="size-3" />
            No wallet
          </span>
        )}
        {canRemove && !isMinted && (
          <Button
            variant="destructive"
            size="xs"
            onClick={handleRemove}
            disabled={isBusy}
            className="gap-1"
          >
            <Undo2 className="size-3" />
            {isRemoving ? "…" : "Remove"}
          </Button>
        )}
        {canRemove && isMinted && (
          <Button
            variant="destructive"
            size="xs"
            onClick={handleWithdraw}
            disabled={isBusy || !attestation.onchainId}
            className="gap-1"
          >
            <Undo2 className="size-3" />
            {isWithdrawing ? "…" : "Withdraw"}
          </Button>
        )}
        {isMinted ? (
          explorerUrl ? (
            <Badge
              variant="positive"
              className="gap-1 cursor-pointer hover:bg-emerald-500/10"
              render={<a href={explorerUrl} target="_blank" rel="noopener noreferrer" />}
            >
              <Link2 className="size-3" />
              Published
            </Badge>
          ) : (
            <Badge variant="positive" className="gap-1">
              <Link2 className="size-3" />
              Published
            </Badge>
          )
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
    <>
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
    </>
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
  const ctx = useUser()
  const { data: session } = useSession()

  const handle = ctx.handle
  const viewerId = session?.user?.id ?? null
  const isSelf = ctx.isSelf

  // Tour: "Publishing Attestations" — triggers on first visit to own attestations page
  const publishingTour = React.useMemo(
    () => (isSelf && handle ? createPublishingTour(handle) : null),
    [isSelf, handle],
  )
  useTourTrigger(publishingTour)

  // Get lastChangedAt from queue context to trigger refetch when cart saves
  const { lastChangedAt, onItemMinted, retractAll } = useAttestationQueue()

  const [cursor, setCursor] = React.useState<string | null>(null)
  const [isFiltersOpen, setIsFiltersOpen] = React.useState(false)
  const [localItems, setLocalItems] = React.useState<Attestation[]>([])

  // Minting state
  const [isMinting, setIsMinting] = React.useState(false)
  const [mintError, setMintError] = React.useState<string | null>(null)
  const [refreshKey, setRefreshKey] = React.useState(0)

  // Wallet state
  const viewerWallet = session?.user?.walletAddress ?? null
  const { address: connectedAddress } = useAccount()
  const chainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { openConnectModal } = useConnectModal()

  const [filters, setFilters] = React.useState<FilterState>({
    q: "",
    type: "",
    status: "",
  })

  // Inject toolbar slot — Filters button
  React.useEffect(() => {
    if (ctx.status !== "ready") {
      ctx.setToolbarSlot(null)
      return
    }
    ctx.setToolbarSlot({
      actions: [{ label: "Filters", icon: Search, active: isFiltersOpen, onClick: () => setIsFiltersOpen((v) => !v) }],
    })
    return () => ctx.setToolbarSlot(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.status, isFiltersOpen])

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
    refreshKey,
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

  const handleRemove = React.useCallback((attestationId: string) => {
    setLocalItems((prev) => prev.filter((a) => a.id !== attestationId))
  }, [])

  // Withdraw a minted attestation — redeems onchain position then soft-deletes in DB
  const handleWithdraw = React.useCallback(async (attestationId: string, onchainId: string) => {
    // Guard: viewer must have a linked wallet
    if (!viewerWallet) {
      setMintError("Link a wallet in Settings to withdraw attestations.")
      return
    }

    // Guard: wallet must be connected and match the linked wallet
    if (!connectedAddress || connectedAddress.toLowerCase() !== viewerWallet.toLowerCase()) {
      setMintError(
        `Connect wallet ${viewerWallet.slice(0, 6)}…${viewerWallet.slice(-4)} to withdraw.`,
      )
      if (openConnectModal) openConnectModal()
      return
    }

    // Ensure wallet is on the Intuition chain
    if (chainId !== INTUITION_CHAIN.id) {
      try {
        await switchChainAsync({ chainId: INTUITION_CHAIN.id })
      } catch {
        setMintError(`Switch your wallet to ${INTUITION_CHAIN.name} and try again.`)
        return
      }
    }

    setMintError(null)

    try {
      // Step 1: Redeem onchain position (wallet signature)
      const result = await withdrawAttestations(
        viewerWallet as Address,
        [{ attestationId, onchainId }],
      )

      // Step 2: Persist withdrawal to DB
      const persistResult = await apiPost<{
        withdrawn: Array<{ id: string; withdrawTxHash: string }>
        skipped: string[]
      }>("/api/attestation/batch-withdraw", {
        items: result.items.map((item) => ({
          attestationId: item.attestationId,
          withdrawTxHash: result.txHash,
        })),
      })

      if (!persistResult.ok) {
        setMintError("Withdrawn on-chain but failed to save. Refresh the page to sync.")
        return
      }

      // Step 3: Remove from local state
      setLocalItems((prev) => prev.filter((a) => a.id !== attestationId))
      setRefreshKey((k) => k + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Withdrawal failed"
      setMintError(message)
    }
  }, [viewerWallet, connectedAddress, chainId, switchChainAsync, openConnectModal])

  // Real on-chain minting — same flow as the cart panel
  const handleMintAll = React.useCallback(async () => {
    // Only mint unminted attestations from the viewer with wallets on the recipient
    const mintable = localItems.filter(
      (a) => a.fromUser.id === viewerId && !a.mintedAt && Boolean(a.toUser.walletAddress),
    )

    if (isMinting || mintable.length === 0) return

    // Guard: viewer must have a linked wallet
    if (!viewerWallet) {
      setMintError("Link a wallet in Settings to publish attestations.")
      return
    }

    // Guard: wallet must be connected and match the linked wallet
    if (!connectedAddress || connectedAddress.toLowerCase() !== viewerWallet.toLowerCase()) {
      setMintError(
        `Connect wallet ${viewerWallet.slice(0, 6)}…${viewerWallet.slice(-4)} to publish.`,
      )
      if (openConnectModal) openConnectModal()
      return
    }

    // Ensure wallet is on the Intuition chain
    if (chainId !== INTUITION_CHAIN.id) {
      try {
        await switchChainAsync({ chainId: INTUITION_CHAIN.id })
      } catch {
        setMintError(`Switch your wallet to ${INTUITION_CHAIN.name} and try again.`)
        return
      }
    }

    setIsMinting(true)
    setMintError(null)

    // Start looping mint sound
    const loopControl = await sounds.loopMintAll()
    let success = false

    try {
      // Build batch items
      const batchItems: BatchMintItem[] = mintable.map((item) => ({
        attestationId: item.id,
        type: item.type,
        toAddress: item.toUser.walletAddress as Address,
        attributeId: item.attributeId ?? undefined,
        stance: (item.stance === "against" ? "against" : "for") as "for" | "against",
      }))

      // Execute on-chain batch (wallet signatures happen here)
      const result = await batchCreateAttestations(
        viewerWallet as Address,
        batchItems,
      )

      // Persist mint results to DB
      const persistResult = await apiPost<{
        minted: Array<{ id: string; mintedAt: string; mintTxHash: string; onchainId: string | null }>
        skipped: string[]
      }>("/api/attestation/batch-mint", {
        items: result.items.map((item) => ({
          attestationId: item.attestationId,
          txHash: result.triplesTxHash,
          onchainId: item.onchainId,
        })),
      })

      if (!persistResult.ok) {
        setMintError("Published on-chain but failed to save. Refresh the page to sync.")
        return
      }

      // Remove minted items from the queue provider
      for (const m of persistResult.value.minted) {
        onItemMinted(m.id)
      }

      // Update local items to reflect minted state (including onchainId for Withdraw)
      const mintedById = new Map(
        persistResult.value.minted.map((m) => [m.id, m]),
      )
      const txHash = result.triplesTxHash
      setLocalItems((prev) =>
        prev.map((a) => {
          const minted = mintedById.get(a.id)
          if (!minted) return a
          return { ...a, mintedAt: new Date().toISOString(), mintTxHash: txHash, onchainId: minted.onchainId }
        }),
      )

      // Show info about skipped items (recipients without wallets)
      const unmintableCount = localItems.filter(
        (a) => a.fromUser.id === viewerId && !a.mintedAt && !a.toUser.walletAddress,
      ).length
      if (unmintableCount > 0) {
        setMintError(
          `${unmintableCount} attestation${unmintableCount !== 1 ? "s" : ""} skipped — recipient${unmintableCount !== 1 ? "s have" : " has"} no linked wallet.`,
        )
      }

      success = true
      // Force refetch to get fresh data
      setRefreshKey((k) => k + 1)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Publishing failed"
      setMintError(message)
    } finally {
      loopControl.stop()
      if (success) sounds.mint()
      setIsMinting(false)
    }
  }, [localItems, viewerId, viewerWallet, connectedAddress, chainId, switchChainAsync, openConnectModal, isMinting, onItemMinted])

  const activeFilters = hasActiveFilters(filters)
  const items = localItems

  // Calculate minting stats
  const [mintStats, setMintStats] = React.useState({ totalCount: 0, mintedCount: 0, mintableCount: 0 })

  React.useEffect(() => {
    const mine = localItems.filter((a) => a.fromUser.id === viewerId)
    const total = mine.length
    const minted = mine.filter((a) => a.mintedAt).length
    const mintable = mine.filter((a) => !a.mintedAt && Boolean(a.toUser.walletAddress)).length

    if (total > 0 || mintStats.totalCount === 0) {
      setMintStats({ totalCount: total, mintedCount: minted, mintableCount: mintable })
    }
  }, [localItems, viewerId, mintStats.totalCount])

  const { totalCount, mintedCount, mintableCount } = mintStats

  // Delete all unminted attestations
  const handleDeleteAll = React.useCallback(async () => {
    if (isMinting) return
    await retractAll()
    // Optimistically remove unminted items from local state
    setLocalItems((prev) => prev.filter((a) => a.fromUser.id !== viewerId || a.mintedAt))
    setRefreshKey((k) => k + 1)
  }, [isMinting, retractAll, viewerId])

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

  if (loading || ctx.status === "loading") return <AttestationsSkeleton isSelf={isSelf} />

  return (
    <>
      {/* Onchain Banner — only show for profile owner */}
      {isSelf && totalCount > 0 && (
        <OnchainBanner
          totalCount={totalCount}
          mintedCount={mintedCount}
          mintableCount={mintableCount}
          isMinting={isMinting}
          onMintAll={handleMintAll}
          onDeleteAll={handleDeleteAll}
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

      {(error || mintError) && (
        <Alert variant="destructive">
          <AlertDescription>{mintError ?? error}</AlertDescription>
        </Alert>
      )}

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {loading || filtering ? "Loading attestations..." : `${items.length} attestations loaded`}
      </div>

      <Card data-tour="attestations-card">
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
                    onRemove={handleRemove}
                    onWithdraw={handleWithdraw}
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
    </>
  )
}
