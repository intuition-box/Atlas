"use client"

import * as React from "react"
import { Link2, Sparkles, Shield, Globe, Loader2, Check, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/* ────────────────────────────
   Types
──────────────────────────── */

type OnchainBannerProps = {
  /** Total attestations (both minted and unminted) */
  totalCount: number
  /** Number of already minted attestations */
  mintedCount: number
  /** IDs of selected attestations to mint */
  selectedIds: Set<string>
  /** Whether any minting operation is in progress */
  isMinting: boolean
  /** Callback to mint all unminted attestations */
  onMintAll: () => void
  /** Callback to mint only selected attestations */
  onMintSelected: () => void
  /** Callback to clear selection */
  onClearSelection: () => void
  /** Optional className */
  className?: string
}

/* ────────────────────────────
   Hook: measure page header
──────────────────────────── */

function usePageHeaderHeight() {
  const [height, setHeight] = React.useState(0)

  React.useEffect(() => {
    const header = document.querySelector("[data-slot='page-header']") as HTMLElement | null
    if (!header) return

    const measure = () => setHeight(header.offsetHeight)
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(header)
    return () => ro.disconnect()
  }, [])

  return height
}

/* ────────────────────────────
   Actions Bar (shared content)
──────────────────────────── */

type ActionsBarProps = {
  unmintedCount: number
  mintedCount: number
  selectedCount: number
  isMinting: boolean
  onMintAll: () => void
  onMintSelected: () => void
  onClearSelection: () => void
  /** When true, hides stats and uses xs buttons */
  compact?: boolean
}

function ActionsBar({
  unmintedCount,
  mintedCount,
  selectedCount,
  isMinting,
  onMintAll,
  onMintSelected,
  onClearSelection,
  compact,
}: ActionsBarProps) {
  const btnSize = compact ? "xs" as const : "default" as const

  return (
    <>
      {!compact && (
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-foreground">{unmintedCount}</span>
            <span className="text-muted-foreground">ready to mint</span>
          </div>
          {mintedCount > 0 && (
            <>
              <span className="text-border">|</span>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-emerald-500">{mintedCount}</span>
                <span className="text-muted-foreground">already onchain</span>
              </div>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-center gap-2">
        {selectedCount > 0 && (
          <Button
            variant="destructive"
            size={btnSize}
            onClick={onClearSelection}
            disabled={isMinting}
            className="gap-2"
          >
            <X className="size-4" />
            Cancel
          </Button>
        )}

        {selectedCount > 0 && (
          <Button
            size={btnSize}
            onClick={onMintSelected}
            disabled={isMinting}
            className="gap-2"
          >
            {isMinting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Minting...
              </>
            ) : (
              <>
                Mint {selectedCount} selected
              </>
            )}
          </Button>
        )}

        <Button
          size={btnSize}
          onClick={onMintAll}
          disabled={isMinting}
          className="gap-2 bg-emerald-500 hover:bg-emerald-500/90"
        >
          {isMinting && selectedCount === 0 ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Minting...
            </>
          ) : (
            <>
              Mint all
            </>
          )}
        </Button>
      </div>
    </>
  )
}

/* ────────────────────────────
   Component
──────────────────────────── */

export function OnchainBanner({
  totalCount,
  mintedCount,
  selectedIds,
  isMinting,
  onMintAll,
  onMintSelected,
  onClearSelection,
  className,
}: OnchainBannerProps) {
  const unmintedCount = totalCount - mintedCount
  const selectedCount = selectedIds.size
  const allMinted = unmintedCount === 0

  const actionsRef = React.useRef<HTMLDivElement>(null)
  const headerHeight = usePageHeaderHeight()
  const [showFixedBar, setShowFixedBar] = React.useState(false)

  // Detect when the inline actions section hits top: 0 of the viewport
  React.useEffect(() => {
    const el = actionsRef.current
    if (!el || allMinted) return

    const observer = new IntersectionObserver(
      ([entry]) => setShowFixedBar(!entry.isIntersecting),
      { threshold: 0, rootMargin: "0px 0px 0px 0px" },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [allMinted])

  if (totalCount === 0) return null

  const actionsProps: ActionsBarProps = {
    unmintedCount,
    mintedCount,
    selectedCount,
    isMinting,
    onMintAll,
    onMintSelected,
    onClearSelection,
  }

  return (
    <>
      <section
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border/60",
          "bg-gradient-to-b from-card/80 via-card/60 to-primary/5",
          className,
        )}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-16 left-1/2 -translate-x-1/2 size-72 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-12 left-1/4 size-48 rounded-full bg-primary/10 blur-2xl" />
          <div className="absolute -bottom-12 right-1/4 size-48 rounded-full bg-primary/8 blur-2xl" />
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
              backgroundSize: "24px 24px",
            }}
          />
        </div>

        <div className="relative flex flex-col gap-6 p-6">
          <div className="flex flex-col items-center gap-4 text-center">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">
                Make Your Attestations Permanent
              </h3>
              <p className="text-sm text-muted-foreground">
                Powered by{" "}
                <a
                  href="https://intuition.systems"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-primary hover:underline"
                >
                  Intuition
                </a>
              </p>
            </div>

            <p className="max-w-lg text-sm text-muted-foreground">
              Intuition is a decentralized protocol for building the world&#39;s first open,
              semantic, and token-curated knowledge graph.
            </p>

            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-primary/70" />
                <span>Verifiable & tamper-proof</span>
              </div>
              <div className="flex items-center gap-2">
                <Globe className="size-4 text-primary/70" />
                <span>Portable across platforms</span>
              </div>
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-primary/70" />
                <span>Truly yours forever</span>
              </div>
            </div>
          </div>

          {!allMinted ? (
            <div
              ref={actionsRef}
              className={cn(
                "flex flex-col items-center gap-4 border-t border-border/40 pt-4",
                "transition-opacity duration-300",
                showFixedBar && "opacity-0",
              )}
            >
              <ActionsBar {...actionsProps} />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 border-t border-border/40 pt-4 text-sm text-primary">
              <Check className="size-4" />
              <span className="font-medium">All {totalCount} attestations minted onchain</span>
            </div>
          )}
        </div>
      </section>

      {!allMinted && (
        <div
          className={cn(
            "fixed left-0 right-0 z-30",
            "transition-all duration-300 ease-out",
            showFixedBar
              ? "translate-y-0 opacity-100"
              : "-translate-y-2 opacity-0 pointer-events-none",
          )}
          style={{ top: headerHeight > 0 ? `${headerHeight}px` : 0 }}
        >
          <div
            className={cn(
              "mx-auto flex w-full max-w-3xl items-center justify-center",
              "rounded-b-2xl border-x border-b border-border/60",
              "bg-gradient-to-br from-card/95 via-card/90 to-primary/10",
              "backdrop-blur-md shadow-md",
              "-mt-4 px-5 pb-2.5 pt-8",
              "overflow-hidden relative",
            )}
          >
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
              <div className="absolute -bottom-8 left-1/4 size-32 rounded-full bg-primary/10 blur-2xl" />
              <div className="absolute -bottom-8 right-1/4 size-32 rounded-full bg-primary/8 blur-2xl" />
            </div>
            <div className="relative">
              <ActionsBar {...actionsProps} compact />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
