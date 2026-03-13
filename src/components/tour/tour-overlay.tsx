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

/** Returns true when the element has been laid out (non-zero bounding rect). */
function hasLayout(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

/**
 * Wait for a DOM element matching `selector` to appear **and** have a
 * non-zero bounding rect (width > 0 && height > 0).
 *
 * Elements with `display: none` or that haven't been laid out yet return
 * `{0, 0, 0, 0}` from `getBoundingClientRect()`. We must not consider
 * those "found" — the spotlight would render at the top-left corner.
 *
 * Uses MutationObserver + a polling interval to catch both DOM insertion
 * and style changes (e.g. `display: none` → `display: block`).
 */
function waitForElement(
  selector: string,
  timeoutMs = WAIT_TIMEOUT_MS,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    // Check immediately
    const existing = document.querySelector<HTMLElement>(selector);
    if (existing && hasLayout(existing)) {
      resolve(existing);
      return;
    }

    let observer: MutationObserver;
    let interval: ReturnType<typeof setInterval>;

    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(interval);
      observer?.disconnect();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, timeoutMs);

    /** Shared check — called by both MutationObserver and polling. */
    const check = () => {
      const el = document.querySelector<HTMLElement>(selector);
      if (el && hasLayout(el)) {
        cleanup();
        resolve(el);
        return true;
      }
      return false;
    };

    observer = new MutationObserver(() => {
      check();
    });

    const root = document.getElementById("__next") ?? document.body;

    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    // Poll every 100ms for style-driven visibility changes
    // (e.g. canvas code sets `display: block` without DOM mutation)
    interval = setInterval(check, 100);
  });
}

/** Sleep utility. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for `window.location.pathname` to match the expected route.
 *
 * During Next.js soft navigation, `router.push()` is async — the URL
 * updates only after the new page has started rendering. Without this
 * guard, `waitForElement` can resolve a same-selector element from the
 * PREVIOUS page (e.g. navigating between user profiles that share a
 * layout), leading to the spotlight appearing at a stale position.
 */
function waitForRoute(
  targetRoute: string,
  timeoutMs: number,
): Promise<boolean> {
  const normalize = (p: string) => p.replace(/\/+$/, "") || "/";
  const target = normalize(targetRoute);

  return new Promise((resolve) => {
    if (normalize(window.location.pathname) === target) {
      resolve(true);
      return;
    }

    const timeout = setTimeout(() => {
      clearInterval(interval);
      resolve(false);
    }, timeoutMs);

    const interval = setInterval(() => {
      if (normalize(window.location.pathname) === target) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve(true);
      }
    }, 50);
  });
}

/**
 * Wait for an element's position to stabilize (layout done shifting).
 * Measures every 50ms, returns once two consecutive reads match within 2px
 * AND the element has non-zero dimensions, or after `maxWaitMs` has elapsed.
 */
async function waitForStablePosition(
  el: HTMLElement,
  maxWaitMs = 500,
): Promise<DOMRect> {
  let prev = el.getBoundingClientRect();
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    await sleep(50);
    const curr = el.getBoundingClientRect();
    const isStable =
      Math.abs(curr.top - prev.top) < 2 &&
      Math.abs(curr.left - prev.left) < 2 &&
      Math.abs(curr.width - prev.width) < 2 &&
      Math.abs(curr.height - prev.height) < 2;

    // Don't accept zero-dimension rects as "stable" — the element
    // might have `display: none` or not yet been laid out.
    if (isStable && curr.width > 0 && curr.height > 0) {
      return curr;
    }
    prev = curr;
  }

  return el.getBoundingClientRect();
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
    tourInstanceId,
    nextStep,
    goToStep,
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

  /** Whether the spotlight has been shown at least once (used to determine dot-transition vs fade-in). */
  const hasShownRef = React.useRef(false);
  const prevRouteRef = React.useRef<string | undefined>(undefined);

  /** Tracks step indices that were auto-skipped (element not found). */
  const [skippedSteps, setSkippedSteps] = React.useState<Set<number>>(new Set());

  /** Dot-transition phase for step changes. */
  const [phase, setPhase] = React.useState<TransitionPhase>("idle");
  const prevRectRef = React.useRef<Rect | null>(null);
  const resolvedRectRef = React.useRef<Rect | null>(null);
  const pendingElRef = React.useRef<HTMLElement | null>(null);
  const collapseReadyRef = React.useRef(false);

  /** Tracks the provider's tourInstanceId so we detect ANY tour start (even same ID). */
  const instanceIdRef = React.useRef(-1);

  /**
   * When true, the rAF loop skips `setRect` calls. This prevents the
   * spotlight from rendering before we've verified the element's position
   * (first step of each tour). Released after SPOTLIGHT_SETTLE_MS in the
   * fade-in path.
   */
  const deferRectRef = React.useRef(false);

  /** Reset every piece of overlay state to a clean slate. */
  const resetOverlay = React.useCallback(() => {
    setTargetEl(null);
    setRect(null);
    setIsTransitioning(false);
    setIsWaiting(false);
    setSkippedSteps(new Set());
    setPhase("idle");
    hasShownRef.current = false;
    prevRouteRef.current = undefined;
    prevRectRef.current = null;
    resolvedRectRef.current = null;
    pendingElRef.current = null;
    collapseReadyRef.current = false;
    deferRectRef.current = false;
  }, []);

  // Resolve target element when step changes
  React.useEffect(() => {
    if (!isRunning || !currentStep) {
      resetOverlay();
      instanceIdRef.current = -1;
      return;
    }

    // Detect any tour start/restart (different instance = different tour run)
    if (tourInstanceId !== instanceIdRef.current) {
      resetOverlay();
      instanceIdRef.current = tourInstanceId;
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
      // If the step requires a different route, wait for the browser
      // pathname to match before looking for DOM elements. Without this,
      // `waitForElement` can grab a same-selector element from the
      // PREVIOUS page (e.g. shared layout between user profiles).
      if (currentStep!.route && isNewPage) {
        const arrived = await waitForRoute(currentStep!.route, WAIT_TIMEOUT_MS);
        if (!arrived || cancelled) return;
      }

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

        // Instant scroll — completes synchronously so the measurement
        // is always accurate. Also cancels any leftover smooth scroll
        // from the previous step. The overlay hides the jump.
        el.scrollIntoView({ behavior: "auto", block: "center" });

        setPopoverSide(currentStep!.side);
        setPopoverAlign(currentStep!.align ?? "center");
        hasShownRef.current = true;
        prevRouteRef.current = currentStep!.route;

        if (useDotTransition) {
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
          // ── Fade-in path (first step only — NO traveling) ──
          //
          // CRITICAL: the spotlight must NOT render until we have a
          // verified, stable position. We use `deferRectRef` to gate
          // all `setRect` calls from the rAF loop, keeping
          // `spotlightTarget` null (and the spotlight hidden) until
          // we're ready.

          // 1. Block rAF from setting rect (keeps spotlight hidden)
          deferRectRef.current = true;

          // 2. Wait for layout to stabilise — the element may exist
          //    but the orbit visualisation / streaming content might
          //    still be shifting things around.
          await waitForStablePosition(el);
          if (cancelled) return;

          // 3. Scroll element into the centre of the viewport.
          el.scrollIntoView({ behavior: "auto", block: "center" });

          // 4. Start the rAF loop (updates prevRectRef but NOT rect
          //    because deferRectRef is true).
          setTargetEl(el);

          // 5. Let the rAF run for SPOTLIGHT_SETTLE_MS so any final
          //    micro-shifts settle.
          await sleep(SPOTLIGHT_SETTLE_MS);
          if (cancelled) return;

          // 6. Release the gate — measure the element NOW and push
          //    the rect in one batch so the spotlight mounts at the
          //    correct, verified position.
          deferRectRef.current = false;
          const finalR = el.getBoundingClientRect();
          const finalComputed = getComputedStyle(el);
          setRect({
            top: finalR.top,
            left: finalR.left,
            width: finalR.width,
            height: finalR.height,
            borderRadius: finalComputed.borderRadius,
          });
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

  // Track target element position with rAF.
  // When `deferRectRef` is true the loop still runs (to keep prevRectRef
  // fresh for dot transitions) but skips `setRect` so the spotlight stays
  // hidden until the fade-in path explicitly releases it.
  React.useEffect(() => {
    if (!targetEl) return;

    let raf: number;
    const track = () => {
      const r = targetEl.getBoundingClientRect();
      const computed = getComputedStyle(targetEl);
      const newRect: Rect = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        borderRadius: computed.borderRadius,
      };
      if (!deferRectRef.current) {
        setRect(newRect);
      }
      prevRectRef.current = newRect; // keep snapshot for dot transition
      raf = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(raf);
  }, [targetEl]);

  // Measure popover dimensions for viewport clamping
  const popoverRef = React.useRef<HTMLDivElement>(null);
  const [popoverSize, setPopoverSize] = React.useState({ width: POPOVER_WIDTH, height: POPOVER_ESTIMATED_HEIGHT });

  // Force popover position recompute on window resize
  const [, forceViewportUpdate] = React.useReducer((x: number) => x + 1, 0);

  React.useEffect(() => {
    const handleResize = () => forceViewportUpdate();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  React.useEffect(() => {
    const el = popoverRef.current;
    if (!el) return;

    const ro = new ResizeObserver(([entry]) => {
      if (!entry) return;

      let width: number;
      let height: number;

      // Safari may return a single object instead of an array
      const box = Array.isArray(entry.borderBoxSize)
        ? entry.borderBoxSize[0]
        : entry.borderBoxSize;

      if (box) {
        width = box.inlineSize;
        height = box.blockSize;
      } else {
        width = entry.contentRect.width;
        height = entry.contentRect.height;
      }

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
      case "expanding": return { type: "spring" as const, stiffness: 400, damping: 35 };
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

  // Find the previous non-skipped step index (for Back button + ArrowLeft)
  const prevVisibleStepIndex = (() => {
    for (let i = currentStepIndex - 1; i >= 0; i--) {
      if (!skippedSteps.has(i)) return i;
    }
    return -1;
  })();

  // Keyboard navigation — lives here (not in TourProvider) so
  // ArrowLeft can jump directly to prevVisibleStepIndex and skip
  // over steps whose DOM target is missing.
  React.useEffect(() => {
    if (!isRunning) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        dismissTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        nextStep();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (prevVisibleStepIndex >= 0) goToStep(prevVisibleStepIndex);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRunning, dismissTour, nextStep, goToStep, prevVisibleStepIndex]);

  // Focus popover when it appears (a11y)
  React.useEffect(() => {
    if (!isTransitioning && rect && popoverRef.current) {
      popoverRef.current.focus({ preventScroll: true });
    }
  }, [isTransitioning, rect, currentStepIndex]);

  // ── Stale-frame guard ──
  // When a new tour starts (tourInstanceId changes), there is ONE render
  // between the provider update and the overlay effect that calls
  // resetOverlay(). During that render, overlay state (rect, phase, etc.)
  // is stale from the previous tour. Block all rendering for that frame.
  const isStaleFrame =
    tourInstanceId !== instanceIdRef.current && instanceIdRef.current !== -1;

  if (!isRunning || isStaleFrame) return null;

  const instanceKey = String(tourInstanceId);

  return (
    <>
      {/* Click catcher — dismisses tour when clicking outside spotlight */}
      <AnimatePresence>
        {rect && (
          <motion.div
            key={`backdrop-${instanceKey}`}
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
            key={`spotlight-${instanceKey}`}
            className={cn(
              "fixed z-[55] pointer-events-none",
              phase === "traveling" && "bg-primary",
            )}
            initial={{ ...spotlightTarget, opacity: 0 }}
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
            key={`step-${instanceKey}-${currentStepIndex}`}
            role="dialog"
            aria-modal="true"
            aria-label={currentStep.title}
            tabIndex={-1}
            className={cn(
              "fixed z-[60] w-80 max-w-[calc(100vw-2rem)]",
              "bg-popover text-popover-foreground",
              "rounded-2xl p-4 shadow-2xl ring-1 ring-foreground/5",
              "flex flex-col gap-3",
              "outline-none",
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
                    onClick={() => goToStep(prevVisibleStepIndex)}
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
            key={`waiting-${instanceKey}`}
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
