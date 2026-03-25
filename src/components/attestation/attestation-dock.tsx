"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronDown, ChevronUp, ShoppingCart } from "lucide-react";

import { cn } from "@/lib/utils";
import { getAttributeById } from "@/lib/attestations/definitions";
import type { AttestationType } from "@/lib/attestations/definitions";
import { Input } from "@/components/ui/input";
import {
  useAttestationQueue,
  type UnmintedAttestation,
} from "./queue-provider";

/* ────────────────────────────
   Constants
──────────────────────────── */

/** Default minimum deposit for attestations (Phase 2 — display-only for now). */
const MIN_DEPOSIT = "0.00042";

/** How long (ms) before the dock auto-hides when not hovered/interacted with. */
const AUTO_HIDE_DELAY = 4_000;

/** Stance options for the toggle buttons. */
const STANCES = [
  {
    key: "against" as const,
    label: "Oppose",
    icon: ChevronDown,
    activeColor: "text-destructive",
    activeBg: "bg-destructive/10",
  },
  {
    key: "for" as const,
    label: "Support",
    icon: ChevronUp,
    activeColor: "text-primary",
    activeBg: "bg-primary/10",
  },
] as const;

/* ────────────────────────────
   Helpers
──────────────────────────── */

/** Build a human-readable verb for the attestation type. */
function getVerb(type: AttestationType): string {
  switch (type) {
    case "FOLLOW":
      return "follows";
    case "TRUST":
      return "trusts";
    case "INTERACTED":
      return "interacted with";
    case "COLLAB_WITH":
      return "collaborates with";
    case "SKILL_ENDORSE":
      return "is skilled in";
    case "TOOL_ENDORSE":
      return "uses";
    default:
      return "attests";
  }
}

/** Build the attestation label: "@viewer verb @target [object]". */
function buildLabel(
  viewerHandle: string | null,
  item: UnmintedAttestation,
): string {
  const viewer = viewerHandle ? `@${viewerHandle}` : "You";
  const target = item.toUser.handle
    ? `@${item.toUser.handle}`
    : item.toUser.name ?? "User";
  const verb = getVerb(item.type);

  // For endorsements: @target is skilled in Product
  if (
    (item.type === "SKILL_ENDORSE" || item.type === "TOOL_ENDORSE") &&
    item.attributeId
  ) {
    const attrLabel =
      getAttributeById(item.attributeId)?.label ?? item.attributeId;
    return `${target} ${verb} ${attrLabel}`;
  }

  return `${viewer} ${verb} ${target}`;
}

/* ────────────────────────────
   Hook: auto-hide with hover tracking
──────────────────────────── */

/**
 * Auto-hide hook that starts **hidden** by default.
 * Call `trigger()` to show the dock and start the countdown.
 * If the user hovers, the timer pauses until they leave.
 * Once the timer fires, the dock hides and stays hidden until the next `trigger()`.
 */
function useAutoHide() {
  const [visible, setVisible] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoveredRef = React.useRef(false);

  const stopTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startTimer = React.useCallback(() => {
    stopTimer();
    if (hoveredRef.current) return;
    timerRef.current = setTimeout(() => setVisible(false), AUTO_HIDE_DELAY);
  }, [stopTimer]);

  /** Show the dock and start the auto-hide countdown. */
  const trigger = React.useCallback(() => {
    setVisible(true);
    stopTimer();
    if (!hoveredRef.current) {
      startTimer();
    }
  }, [stopTimer, startTimer]);

  /** Reset the countdown (e.g. on user interaction while dock is visible). */
  const resetTimer = React.useCallback(() => {
    if (!visible) return;
    startTimer();
  }, [visible, startTimer]);

  const onMouseEnter = React.useCallback(() => {
    hoveredRef.current = true;
    stopTimer();
  }, [stopTimer]);

  const onMouseLeave = React.useCallback(() => {
    hoveredRef.current = false;
    if (visible) startTimer();
  }, [visible, startTimer]);

  // Cleanup on unmount
  React.useEffect(() => stopTimer, [stopTimer]);

  return { visible, trigger, resetTimer, onMouseEnter, onMouseLeave };
}

/* ────────────────────────────
   Component
──────────────────────────── */

export function AttestationDock({ className }: { className?: string }) {
  const { data: session } = useSession();
  const viewerHandle = session?.user?.handle ?? null;
  const { unminted, isOpen, setIsOpen, updateStance, updateDepositAmount, lastCreatedAt } =
    useAttestationQueue();

  // Show the most recent attestation (first in array — we prepend on create)
  const latest = unminted[0] ?? null;
  const count = unminted.length;
  const hasItems = latest !== null;

  // Auto-hide: starts hidden, only triggered by new attestation creation
  const { visible: autoVisible, trigger, resetTimer, onMouseEnter, onMouseLeave } =
    useAutoHide();

  // Trigger dock visibility only when a new attestation is created
  React.useEffect(() => {
    if (lastCreatedAt > 0) trigger();
  }, [lastCreatedAt, trigger]);

  // Deposit amount — read from DB-backed queue state, fall back to display default
  const depositAmount = latest?.depositAmount || MIN_DEPOSIT;
  const setDepositAmount = React.useCallback(
    (val: string) => {
      if (latest) updateDepositAmount(latest.id, val);
    },
    [latest, updateDepositAmount],
  );
  // Show dock only when there are items, panel is not open, and not auto-hidden
  const show = hasItems && !isOpen && autoVisible;

  const isSupport = latest?.stance !== "against";
  const label = latest ? buildLabel(viewerHandle, latest) : "";

  const handleStanceChange = (stance: "for" | "against") => {
    if (!latest) return;
    updateStance(latest.id, stance);
    resetTimer();
  };

  // Stance-aware accent class for input / trigger borders
  const accentBorder = isSupport ? "border-primary" : "border-destructive";
  const accentRing = isSupport
    ? "focus-visible:ring-primary/30"
    : "focus-visible:ring-destructive/30";

  return (
    <AnimatePresence mode="wait">
      {show && latest && (
        <motion.div
          key={latest.id}
          data-tour="attestation-dock"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={cn(
            "fixed bottom-6 left-1/2 z-50 -translate-x-1/2 pointer-events-auto",
            className,
          )}
          onMouseEnter={onMouseEnter}
          onMouseLeave={onMouseLeave}
        >
          <div
            className={cn(
              "w-[360px] rounded-2xl border border-border/60",
              "bg-card p-4 shadow-lg backdrop-blur-sm",
              "ring-1 ring-black/5",
            )}
          >
            {/* ── Action bar: Oppose | Support + Cart ── */}
            <div className="mb-3 flex items-center gap-1.5">
              {/* Stance toggle */}
              <div className="flex items-center gap-0.5 rounded-full border border-border bg-input/30 bg-clip-padding px-0.5 py-[3px] flex-1">
                {STANCES.map((stance) => {
                  const Icon = stance.icon;
                  const isActive = isSupport
                    ? stance.key === "for"
                    : stance.key === "against";
                  return (
                    <button
                      key={stance.key}
                      type="button"
                      onClick={() => handleStanceChange(stance.key)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5",
                        "text-sm leading-none font-medium transition-colors duration-200",
                        isActive
                          ? cn(stance.activeBg, stance.activeColor)
                          : "text-muted-foreground hover:bg-input/50 hover:text-foreground",
                      )}
                    >
                      <Icon size={16} />
                      {stance.label}
                    </button>
                  );
                })}
              </div>

              {/* Cart button — independent */}
              <button
                type="button"
                onClick={() => setIsOpen(true)}
                className={cn(
                  "relative flex items-center justify-center rounded-full",
                  "border border-border bg-input/30",
                  "size-8 shrink-0",
                  "text-muted-foreground hover:bg-input/50 hover:text-foreground",
                  "transition-colors duration-200",
                )}
                aria-label={`${count} attestation${count !== 1 ? "s" : ""} in queue`}
              >
                <ShoppingCart size={14} />
                {count > 0 && (
                  <span className="absolute -top-1 -right-0.5 flex items-center justify-center min-w-4 h-4 px-0.5 text-[9px] font-bold rounded-full bg-primary text-primary-foreground">
                    {count > 99 ? "99+" : count}
                  </span>
                )}
              </button>
            </div>

            {/* ── Attestation label ── */}
            <p className="text-sm leading-snug mb-3 truncate text-center" title={label}>
              {label}
            </p>

            {/* ── Deposit input + curve menu ── */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={depositAmount}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (/^\d*\.?\d*$/.test(val)) {
                        setDepositAmount(val);
                        resetTimer();
                      }
                    }}
                    className={cn(
                      "h-8 pr-14 text-sm font-mono",
                      accentBorder,
                      accentRing,
                    )}
                    aria-label="Deposit amount in TRUST"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium pointer-events-none">
                    TRUST
                  </span>
                </div>

                {/* Curve selector — disabled until exponential curve is deployed */}
              </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
