"use client"

import * as React from "react"
import { motion, AnimatePresence } from "motion/react"
import { X, Link2, Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/* ────────────────────────────
   Types
──────────────────────────── */

type SelectionActionBarProps = {
  /** Number of selected items */
  selectedCount: number
  /** Whether minting is in progress */
  isMinting: boolean
  /** Callback to mint selected items */
  onMintSelected: () => void
  /** Callback to clear selection */
  onClearSelection: () => void
  /** Optional className */
  className?: string
}

/* ────────────────────────────
   Component
──────────────────────────── */

export function SelectionActionBar({
  selectedCount,
  isMinting,
  onMintSelected,
  onClearSelection,
  className,
}: SelectionActionBarProps) {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className={cn(
            "fixed bottom-6 left-1/2 z-50 -translate-x-1/2",
            className
          )}
        >
          <div
            className={cn(
              "flex items-center gap-3 rounded-2xl border border-border/60",
              "bg-card/95 px-4 py-3 shadow-lg backdrop-blur-sm",
              "ring-1 ring-black/5"
            )}
          >
            {/* Selection count */}
            <div className="flex items-center gap-2 pr-3 border-r border-border/60">
              <span className="text-sm font-medium">
                {selectedCount} selected
              </span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={onClearSelection}
                disabled={isMinting}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4 mr-1" />
                Cancel
              </Button>

              <Button
                size="sm"
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
                    Mint {selectedCount}
                  </>
                )}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
