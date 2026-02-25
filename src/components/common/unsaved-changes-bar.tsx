"use client"

import * as React from "react"
import { motion, AnimatePresence } from "motion/react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

interface UnsavedChangesBarProps {
  /** Whether there are unsaved changes to show the bar */
  show: boolean
  /** Whether saving is in progress */
  saving?: boolean
  /** Message shown on the left side */
  message?: string
  /** Callback to save changes */
  onSave: () => void
  /** Callback to reset/discard changes */
  onReset: () => void
  /** Optional className for the outer wrapper */
  className?: string
}

export function UnsavedChangesBar({
  show,
  saving = false,
  message = "You have unsaved changes!",
  onSave,
  onReset,
  className,
}: UnsavedChangesBarProps) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "fixed bottom-6 left-1/2 z-50 -translate-x-1/2",
            className,
          )}
        >
          <div
            className={cn(
              "flex items-center gap-16 rounded-2xl border border-border/60",
              "bg-card px-5 py-3 shadow-lg backdrop-blur-sm",
              "ring-1 ring-black/5",
            )}
          >
            <span className="text-sm font-medium whitespace-nowrap">
              {message}
            </span>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={onReset}
                className="hover:text-destructive"
              >
                Reset
              </Button>

              <Button
                type="button"
                variant="positive"
                size="sm"
                disabled={saving}
                onClick={onSave}
              >
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
