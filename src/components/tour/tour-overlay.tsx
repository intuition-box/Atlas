"use client";

import * as React from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useTour } from "./tour-provider";

/* ────────────────────────────
   Constants
──────────────────────────── */

/** Padding around the spotlight cutout (px). */
const SPOTLIGHT_PADDING = 8;

/** How long to wait for a target element after navigation (ms). */
const WAIT_TIMEOUT_MS = 5_000;

/** Delay after scrollIntoView before showing the popover (ms). */
const SCROLL_SETTLE_MS = 350;

/** Popover width in px (matches `w-80` = 20rem = 320px). */
const POPOVER_WIDTH = 320;

/** Estimated popover height for initial render (px). Refined by ResizeObserver. */
const POPOVER_ESTIMATED_HEIGHT = 160;

/** Minimum gap between popover and viewport edge (px). */
const VIEWPORT_MARGIN = 16;

/** Time to wait for the spotlight spring animation to settle before fading in the popover (ms). */
const SPOTLIGHT_SETTLE_MS = 400;

/** Size of the traveling dot between steps (px). */
const DOT_SIZE = 8;

/** Duration of each dot-transition phase (seconds). */
const COLLAPSE_DURATION = 0.15;
const TRAVEL_DURATION = 0.2;
const EXPAND_DURATION = 0.15;

/* ────────────────────────────
   Utilities
──────────────────────────── */

/**
 * Wait for a DOM element matching `selector` to appear.
 * Uses MutationObserver with a timeout fallback.
 */
function waitForElement(
  selector: string,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    // Check immediately
    const existing = document.querySelector<HTMLElement>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

/** Sleep utility. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ────────────────────────────
   Types
──────────────────────────── */

type Rect = {
  top: number;
  left: number;
  width: number;
  height: number;
  borderRadius: string;
};

type TransitionPhase = "idle" | "collapsing" | "traveling" | "expanding";

/* ────────────────────────────
   Component
──────────────────────────── */

export function TourOverlay() {
  const {
    isRunning,
    activeTour,
    currentStep,
    currentStepIndex,
    totalSteps,
    nextStep,
    prevStep,
    dismissTour,
  } = useTour();

  const [targetEl, setTargetEl] = React.useState<HTMLElement | null>(null);
  const [rect, setRect] = React.useState<Rect | null>(null);
  const [isWaiting, setIsWaiting] = React.useState(false);
  const [popoverSide, setPopoverSide] = React.useState<"top" | "bottom" | "left" | "right">("bottom");
  const [popoverAlign, setPopoverAlign] = React.useState<"start" | "center" | "end">("center");

  /**
   * Controls popover visibility independently from the spotlight.
   * true = popover hidden (spotlight animating to new position).
   * false = popover visible.
   */
  const [isTransitioning, setIsTransitioning] = React.useState(false);

  /** Whether the spotlight has been shown at least once (used to fade-in first, slide subsequent). */
  const hasShownRef = React.useRef(false);
  const prevRouteRef = React.useRef<string | undefined>(undefined);
  const [isFirstSpotlight, setIsFirstSpotlight] = React.useState(true);

  /** Tracks step indices that were auto-skipped (element not found). */
  const [skippedSteps, setSkippedSteps] = React.useState<Set<number>>(new Set());

  /** Dot-transition phase for step changes. */
  const [phase, setPhase] = React.useState<TransitionPhase>("idle");
  const prevRectRef = React.useRef<Rect | null>(null);
  const resolvedRectRef = React.useRef<Rect | null>(null);
  const pendingElRef = React.useRef<HTMLElement | null>(null);
  const collapseReadyRef = React.useRef(false);

  /** Tracks which tour is active so we can detect direct tour-to-tour switches. */
  const activeTourIdRef = React.useRef<string | null>(null);

  // Resolve target element when step changes
  React.useEffect(() => {
    if (!isRunning || !currentStep) {
      setTargetEl(null);
      setRect(null);
      hasShownRef.current = false;
      prevRouteRef.current = undefined;
      setIsFirstSpotlight(true);
      setSkippedSteps(new Set());
      setPhase("idle");
      prevRectRef.current = null;
      resolvedRectRef.current = null;
      pendingElRef.current = null;
      collapseReadyRef.current = false;
      activeTourIdRef.current = null;
      return;
    }

    // Detect direct tour-to-tour switch (isRunning never went false)
    const tourChanged = activeTour?.id !== activeTourIdRef.current;
    if (tourChanged) {
      hasShownRef.current = false;
      prevRouteRef.current = undefined;
      setIsFirstSpotlight(true);
      setRect(null);
      prevRectRef.current = null;
      resolvedRectRef.current = null;
      pendingElRef.current = null;
      collapseReadyRef.current = false;
      activeTourIdRef.current = activeTour?.id ?? null;
    }

    let cancelled = false;
    const isFirstStep = !hasShownRef.current;
    const isNewPage = currentStep.route !== prevRouteRef.current;
    const useDotTransition = !isFirstStep;

    // Hide popover immediately
    setIsTransitioning(true);
    setIsWaiting(true);

    // Reset dot animation refs
    resolvedRectRef.current = null;
    pendingElRef.current = null;
    collapseReadyRef.current = false;

    if (useDotTransition) {
      // Start dot collapse animation (same-page or cross-page)
      // prevRectRef.current is already maintained by the rAF loop
      setPhase("collapsing");
      setTargetEl(null); // stop rAF, rect stays frozen
    } else {
      // First step: fade-in behavior
      setPhase("idle");
      setTargetEl(null);
    }

    async function resolve() {
      const timeout = isNewPage ? WAIT_TIMEOUT_MS : 1_000;
      let el = await waitForElement(currentStep!.target, timeout);

      if (!el && currentStep!.fallbackTarget) {
        el = document.querySelector<HTMLElement>(currentStep!.fallbackTarget);
      }
      if (cancelled) return;

      if (el) {
        // Pre-scan future steps for missing elements
        if (activeTour) {
          const currentRoute = currentStep!.route;
          const missing = new Set<number>();
          for (let i = currentStepIndex + 1; i < activeTour.steps.length; i++) {
            const s = activeTour.steps[i]!;
            if (s.route !== currentRoute) break;
            const hasTarget = document.querySelector(s.target) || (s.fallbackTarget && document.querySelector(s.fallbackTarget));
            if (!hasTarget) missing.add(i);
          }
          if (missing.size > 0) {
            setSkippedSteps((prev) => {
              const next = new Set(prev);
              missing.forEach((i) => next.add(i));
              return next;
            });
          }
        }

        el.scrollIntoView({ behavior: "smooth", block: "center" });
        await sleep(SCROLL_SETTLE_MS);
        if (cancelled) return;

        setPopoverSide(currentStep!.side);
        setPopoverAlign(currentStep!.align ?? "center");
        hasShownRef.current = true;
        prevRouteRef.current = currentStep!.route;

        if (useDotTransition) {
          // Measure destination rect for the dot animation
          const newR = el.getBoundingClientRect();
          const newComputed = getComputedStyle(el);
          resolvedRectRef.current = {
            top: newR.top,
            left: newR.left,
            width: newR.width,
            height: newR.height,
            borderRadius: newComputed.borderRadius,
          };
          pendingElRef.current = el;

          // If collapse already completed, advance to traveling
          if (collapseReadyRef.current) {
            collapseReadyRef.current = false;
            setTargetEl(el);
            pendingElRef.current = null;
            setPhase("traveling");
          }
          // Otherwise handlePhaseComplete will advance when collapse finishes
        } else {
          // Fade-in path (first step only)
          setTargetEl(el);
          await sleep(SPOTLIGHT_SETTLE_MS);
          if (cancelled) return;

          setIsFirstSpotlight(false);
          setIsTransitioning(false);
        }
      } else if (currentStepIndex < totalSteps - 1) {
        setSkippedSteps((prev) => new Set(prev).add(currentStepIndex));
        setPhase("idle");
        nextStep();
      } else {
        setPhase("idle");
        dismissTour();
      }

      setIsWaiting(false);
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [isRunning, currentStep, currentStepIndex, nextStep]);

  // Track target element position with rAF
  React.useEffect(() => {
    if (!targetEl) return;

    let raf: number;
    const computed = getComputedStyle(targetEl);
    const track = () => {
      const r = targetEl.getBoundingClientRect();
      const newRect: Rect = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        borderRadius: computed.borderRadius,
      };
      setRect(newRect);
      prevRectRef.current = newRect; // keep snapshot for dot transition
      raf = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(raf);
  }, [targetEl]);

  // Measure popover dimensions for viewport clamping
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const [popoverSize, setPopoverSize] = React.useState({ width: POPOVER_WIDTH, height: POPOVER_ESTIMATED_HEIGHT });

  React.useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.borderBoxSize[0]
        ? { width: entry.borderBoxSize[0].inlineSize, height: entry.borderBoxSize[0].blockSize }
        : entry.contentRect;
      setPopoverSize((prev) =>
        prev.width === width && prev.height === height ? prev : { width, height },
      );
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [currentStepIndex]);

  // Compute popover position with viewport-aware clamping + auto-flip
  const popoverPosition = currentStep?.popoverPosition;
  const { style: popoverStyle, resolvedSide, needsCenterX, needsCenterY } = React.useMemo<{
    style: React.CSSProperties;
    resolvedSide: "top" | "bottom" | "left" | "right";
    needsCenterX: boolean;
    needsCenterY: boolean;
  }>(() => {
    if (!rect) return { style: { display: "none" }, resolvedSide: popoverSide, needsCenterX: false, needsCenterY: false };

    // Fixed viewport corner — overrides all side/align logic
    if (popoverPosition) {
      const cornerStyle: React.CSSProperties = {};
      if (popoverPosition.startsWith("top")) cornerStyle.top = VIEWPORT_MARGIN;
      else cornerStyle.bottom = VIEWPORT_MARGIN;
      if (popoverPosition.endsWith("left")) cornerStyle.left = VIEWPORT_MARGIN;
      else cornerStyle.right = VIEWPORT_MARGIN;
      return { style: cornerStyle, resolvedSide: popoverSide, needsCenterX: false, needsCenterY: false };
    }

    const pad = SPOTLIGHT_PADDING;
    const gap = 12;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = popoverSize.width;
    const ph = popoverSize.height;

    // Available space on each side
    const spaceBottom = vh - (rect.top + rect.height + pad + gap);
    const spaceTop = rect.top - pad - gap;
    const spaceRight = vw - (rect.left + rect.width + pad + gap);
    const spaceLeft = rect.left - pad - gap;

    // Auto-flip if preferred side doesn't have enough room
    let side = popoverSide;
    if (side === "bottom" && spaceBottom < ph + VIEWPORT_MARGIN && spaceTop > spaceBottom) {
      side = "top";
    } else if (side === "top" && spaceTop < ph + VIEWPORT_MARGIN && spaceBottom > spaceTop) {
      side = "bottom";
    } else if (side === "right" && spaceRight < pw + VIEWPORT_MARGIN && spaceLeft > spaceRight) {
      side = "left";
    } else if (side === "left" && spaceLeft < pw + VIEWPORT_MARGIN && spaceRight > spaceLeft) {
      side = "right";
    }

    // Alias for narrowed rect (guaranteed non-null by the guard above)
    const r = rect;

    // Cross-axis helpers — always center on the highlight
    function horizontalStyle(): React.CSSProperties {
      if (popoverAlign === "end") {
        const idealRight = vw - (r.left + r.width);
        return { right: Math.max(VIEWPORT_MARGIN, idealRight) };
      }
      if (popoverAlign === "center") {
        // Set left to target's horizontal center — motion x="-50%" handles the offset
        return { left: r.left + r.width / 2 };
      }
      return { left: Math.max(VIEWPORT_MARGIN, r.left) };
    }

    function verticalStyle(): React.CSSProperties {
      if (popoverAlign === "end") {
        const idealBottom = vh - (r.top + r.height);
        return { bottom: Math.max(VIEWPORT_MARGIN, idealBottom) };
      }
      if (popoverAlign === "center") {
        // Set top to target's vertical center — motion y="-50%" handles the offset
        const centerY = r.top + r.height / 2;
        return { top: centerY };
      }
      return { top: Math.max(VIEWPORT_MARGIN, Math.min(r.top, vh - ph - VIEWPORT_MARGIN)) };
    }

    // Whether the popover needs CSS-precise centering via motion x/y="-50%"
    const centerX = (side === "top" || side === "bottom") && popoverAlign === "center";
    const centerY = (side === "right" || side === "left") && popoverAlign === "center";

    // Compute position with cross-axis alignment + clamping
    switch (side) {
      case "bottom":
        return {
          style: { top: r.top + r.height + pad + gap, ...horizontalStyle() },
          resolvedSide: side,
          needsCenterX: centerX,
          needsCenterY: false,
        };
      case "top":
        return {
          style: { bottom: vh - r.top + pad + gap, ...horizontalStyle() },
          resolvedSide: side,
          needsCenterX: centerX,
          needsCenterY: false,
        };
      case "right":
        return {
          style: { left: r.left + r.width + pad + gap, ...verticalStyle() },
          resolvedSide: side,
          needsCenterX: false,
          needsCenterY: centerY,
        };
      case "left":
        return {
          style: { right: vw - r.left + pad + gap, ...verticalStyle() },
          resolvedSide: side,
          needsCenterX: false,
          needsCenterY: centerY,
        };
    }
  }, [rect, popoverSide, popoverAlign, popoverSize, popoverPosition]);

  // ── Dot transition: phase complete handler ──
  const handlePhaseComplete = React.useCallback(() => {
    if (phase === "collapsing") {
      if (resolvedRectRef.current) {
        if (pendingElRef.current) {
          setTargetEl(pendingElRef.current);
          pendingElRef.current = null;
        }
        setPhase("traveling");
      } else {
        // Collapse finished before element resolved — wait
        collapseReadyRef.current = true;
      }
    } else if (phase === "traveling") {
      setPhase("expanding");
    } else if (phase === "expanding") {
      setPhase("idle");
      setIsTransitioning(false);
      setIsFirstSpotlight(false);
    }
  }, [phase]);

  // ── Dot transition: computed spotlight target ──
  const spotlightTarget = React.useMemo(() => {
    if (phase === "collapsing") {
      const prev = prevRectRef.current;
      if (!prev) return null;
      return {
        opacity: 1,
        top: prev.top + prev.height / 2 - DOT_SIZE / 2,
        left: prev.left + prev.width / 2 - DOT_SIZE / 2,
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: prev.borderRadius, // keep original — browser clamps at small sizes
      };
    }
    if (phase === "traveling") {
      const next = resolvedRectRef.current;
      if (!next) return null;
      return {
        opacity: 1,
        top: next.top + next.height / 2 - DOT_SIZE / 2,
        left: next.left + next.width / 2 - DOT_SIZE / 2,
        width: DOT_SIZE,
        height: DOT_SIZE,
        borderRadius: `${DOT_SIZE / 2}px`,
      };
    }
    // expanding or idle — use live rect
    if (!rect) return null;
    return {
      opacity: 1,
      top: rect.top - SPOTLIGHT_PADDING,
      left: rect.left - SPOTLIGHT_PADDING,
      width: rect.width + SPOTLIGHT_PADDING * 2,
      height: rect.height + SPOTLIGHT_PADDING * 2,
      borderRadius: rect.borderRadius,
    };
  }, [phase, rect]);

  // ── Dot transition: phase-aware transition config ──
  const spotlightTransition = React.useMemo(() => {
    switch (phase) {
      case "collapsing": return { duration: COLLAPSE_DURATION, ease: "linear" as const };
      case "traveling": return { duration: TRAVEL_DURATION, ease: "linear" as const };
      case "expanding": return { duration: EXPAND_DURATION, ease: "linear" as const };
      default: return { duration: 0.3, ease: "linear" as const };
    }
  }, [phase]);

  // Compute display counter that excludes skipped steps
  const displayTotal = totalSteps - skippedSteps.size;
  const skippedBefore = [...skippedSteps].filter((i) => i < currentStepIndex).length;
  const displayIndex = currentStepIndex + 1 - skippedBefore;

  // Whether the current step is the last *visible* step
  const isLastVisibleStep = (() => {
    for (let i = currentStepIndex + 1; i < totalSteps; i++) {
      if (!skippedSteps.has(i)) return false;
    }
    return true;
  })();

  // Find the previous non-skipped step index (for Back button)
  const prevVisibleStepIndex = (() => {
    for (let i = currentStepIndex - 1; i >= 0; i--) {
      if (!skippedSteps.has(i)) return i;
    }
    return -1;
  })();

  if (!isRunning) return null;

  const tourId = activeTour?.id ?? "none";

  return (
    <>
      {/* Click catcher — dismisses tour when clicking outside spotlight */}
      <AnimatePresence>
        {rect && (
          <motion.div
            key={`backdrop-${tourId}`}
            className="fixed inset-0 z-[54]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "linear" }}
            onClick={dismissTour}
          />
        )}
      </AnimatePresence>

      {/* Spotlight cutout — morphs into a primary dot between steps */}
      <AnimatePresence>
        {spotlightTarget && (
          <motion.div
            key={`spotlight-${tourId}`}
            className={cn(
              "fixed z-[55] pointer-events-none",
              phase === "traveling" && "bg-primary",
            )}
            initial={
              isFirstSpotlight
                ? { ...spotlightTarget, opacity: 0 }
                : undefined
            }
            animate={spotlightTarget}
            exit={{ opacity: 0 }}
            transition={spotlightTransition}
            onAnimationComplete={handlePhaseComplete}
            style={{
              boxShadow: "0 0 0 9999px rgba(0, 0, 0, 0.6)",
              transitionProperty: "background-color",
              transitionDuration: `${TRAVEL_DURATION}s`,
              transitionTimingFunction: "linear",
            }}
          />
        )}
      </AnimatePresence>

      {/* Step card popover — hidden during spotlight transition */}
      <AnimatePresence mode="wait">
        {rect && currentStep && !isTransitioning && (
          <motion.div
            ref={popoverRef}
            key={`step-${tourId}-${currentStepIndex}`}
            className={cn(
              "fixed z-[60] w-80 max-w-[calc(100vw-2rem)]",
              "bg-popover text-popover-foreground",
              "rounded-2xl p-4 shadow-2xl ring-1 ring-foreground/5",
              "flex flex-col gap-3",
            )}
            style={popoverStyle}
            initial={{
              opacity: 0,
              scale: 0.95,
              x: needsCenterX ? "-50%" : 0,
              y: needsCenterY ? "-50%" : resolvedSide === "bottom" ? -8 : resolvedSide === "top" ? 8 : 0,
            }}
            animate={{
              opacity: 1,
              scale: 1,
              x: needsCenterX ? "-50%" : 0,
              y: needsCenterY ? "-50%" : 0,
            }}
            exit={{
              opacity: 0,
              scale: 0.95,
              x: needsCenterX ? "-50%" : 0,
              y: needsCenterY ? "-50%" : 0,
            }}
            transition={{ duration: 0.15, ease: "linear" }}
          >
            {/* Title + step counter */}
            <div className="flex items-center justify-between">
              <h3 className="text-base font-medium">{currentStep.title}</h3>
              <span className="text-xs text-muted-foreground">
                {displayIndex} of {displayTotal}
              </span>
            </div>

            {/* Description */}
            {currentStep.description.split("\n\n").map((paragraph, i) => (
              <p key={i} className="text-sm text-muted-foreground">{paragraph}</p>
            ))}

            {/* Navigation */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {prevVisibleStepIndex >= 0 && (
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={prevStep}
                  >
                    <ArrowLeft className="size-3" />
                    Back
                  </Button>
                )}
                <Button
                  variant="solid"
                  size="xs"
                  onClick={nextStep}
                >
                  {isLastVisibleStep ? "Done" : "Next"}
                  {!isLastVisibleStep && <ArrowRight className="size-3" />}
                </Button>
              </div>
              <Button
                variant="ghost"
                size="xs"
                className="text-destructive hover:text-destructive"
                onClick={dismissTour}
              >
                Skip
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading state — subtle backdrop while waiting for element */}
      <AnimatePresence>
        {isWaiting && !rect && (
          <motion.div
            key={`waiting-${tourId}`}
            className="fixed inset-0 z-[54] bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: "linear" }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
