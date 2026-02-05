"use client"

import * as React from "react"
import { Link2, Sparkles, Shield, Globe, Loader2, Check } from "lucide-react"

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
  /** Optional className */
  className?: string
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
  className,
}: OnchainBannerProps) {
  const unmintedCount = totalCount - mintedCount
  const selectedCount = selectedIds.size
  const allMinted = unmintedCount === 0

  // Don't show banner if there are no attestations
  if (totalCount === 0) return null

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border/60",
        "bg-gradient-to-br from-card/80 via-card/60 to-primary/5",
        className
      )}
    >
      {/* Decorative background elements */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-20 -top-20 size-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-10 -left-10 size-48 rounded-full bg-primary/10 blur-2xl" />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)`,
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between">
        {/* Left: Content */}
        <div className="flex flex-col gap-4">
          {/* Header with Intuition branding */}
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Link2 className="size-5" />
            </div>
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
          </div>

          {/* Benefits */}
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
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

          {/* Stats */}
          <div className="flex items-center gap-4 text-sm">
            {allMinted ? (
              <div className="flex items-center gap-2 text-primary">
                <Check className="size-4" />
                <span className="font-medium">All {totalCount} attestations minted onchain</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold text-foreground">{unmintedCount}</span>
                  <span className="text-muted-foreground">ready to mint</span>
                </div>
                {mintedCount > 0 && (
                  <>
                    <span className="text-border">|</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-primary">{mintedCount}</span>
                      <span className="text-muted-foreground">already onchain</span>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Right: Actions */}
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center">
          {selectedCount > 0 && !allMinted && (
            <Button
              variant="outline"
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
                  <Link2 className="size-4" />
                  Mint {selectedCount} Selected
                </>
              )}
            </Button>
          )}

          {!allMinted && (
            <Button
              onClick={onMintAll}
              disabled={isMinting}
              className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {isMinting && selectedCount === 0 ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Minting...
                </>
              ) : (
                <>
                  <Sparkles className="size-4" />
                  Mint All {unmintedCount}
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
