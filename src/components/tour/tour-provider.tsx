"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

import type { TourDefinition, TourStep } from "./tour-definitions";
import { createWelcomeTour } from "./tour-definitions";
import { TourOverlay } from "./tour-overlay";

/* ────────────────────────────
   Persistence
──────────────────────────── */

const STORAGE_KEY = "atlas-tours-completed";

function getCompletedTours(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function markTourCompleted(tourId: string): void {
  try {
    const completed = getCompletedTours();
    if (!completed.includes(tourId)) {
      completed.push(tourId);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
    }
  } catch {
    // Ignore localStorage errors (SSR, private browsing, etc.)
  }
}

function unmarkTourCompleted(tourId: string): void {
  try {
    const completed = getCompletedTours().filter((id) => id !== tourId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(completed));
  } catch {
    // Ignore localStorage errors
  }
}

/* ────────────────────────────
   Context
──────────────────────────── */

type TourContextValue = {
  /** Whether a tour is currently running */
  isRunning: boolean;
  /** The active tour definition, or null */
  activeTour: TourDefinition | null;
  /** The current step, or null */
  currentStep: TourStep | null;
  /** Zero-based index of the current step */
  currentStepIndex: number;
  /** Total steps in the active tour */
  totalSteps: number;

  /** Start a specific tour (ignores completion state) */
  startTour: (tour: TourDefinition) => void;
  /** Advance to the next step (or finish if on last step) */
  nextStep: () => void;
  /** Go back to the previous step */
  prevStep: () => void;
  /** Dismiss the tour without marking it completed (Skip / backdrop / Escape) */
  dismissTour: () => void;
  /** Trigger a tour (no-op if already completed or another tour is running) */
  trigger: (tour: TourDefinition) => void;
  /** Check if a tour has been completed */
  isTourCompleted: (tourId: string) => boolean;
  /** Reset a tour's completion state so it can be triggered again */
  resetTour: (tourId: string) => void;
};

const TourContext = React.createContext<TourContextValue | null>(null);

/* ────────────────────────────
   Provider
──────────────────────────── */

export function TourProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const isAuthed = !!session?.user?.handle;

  const [activeTour, setActiveTour] = React.useState<TourDefinition | null>(null);
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);
  const [completedTours, setCompletedTours] = React.useState<string[]>([]);

  // Load completed tours from localStorage on mount
  React.useEffect(() => {
    setCompletedTours(getCompletedTours());
  }, []);

  const isRunning = activeTour !== null;
  const totalSteps = activeTour?.steps.length ?? 0;
  const currentStep = activeTour?.steps[currentStepIndex] ?? null;

  // Track current step's route to detect cross-page navigation
  const currentRouteRef = React.useRef<string | undefined>(undefined);

  const startTour = React.useCallback(
    (tour: TourDefinition) => {
      setActiveTour(tour);
      setCurrentStepIndex(0);

      const firstStep = tour.steps[0];
      if (firstStep?.route) {
        currentRouteRef.current = firstStep.route;
        router.push(firstStep.route);
      }
    },
    [router],
  );

  /** Stop the tour without persisting (used by Skip, backdrop, Escape). */
  const dismissTour = React.useCallback(() => {
    setActiveTour(null);
    setCurrentStepIndex(0);
    currentRouteRef.current = undefined;
  }, []);

  const navigateToStep = React.useCallback(
    (step: TourStep) => {
      if (step.route && step.route !== currentRouteRef.current) {
        currentRouteRef.current = step.route;
        router.push(step.route);
      }
    },
    [router],
  );

  const nextStep = React.useCallback(() => {
    if (!activeTour) return;

    const nextIdx = currentStepIndex + 1;
    if (nextIdx >= activeTour.steps.length) {
      // "Done" — the ONLY path that persists completion to localStorage
      markTourCompleted(activeTour.id);
      setCompletedTours((prev) =>
        prev.includes(activeTour.id) ? prev : [...prev, activeTour.id],
      );
      setActiveTour(null);
      setCurrentStepIndex(0);
      currentRouteRef.current = undefined;
      return;
    }

    setCurrentStepIndex(nextIdx);
    navigateToStep(activeTour.steps[nextIdx]!);
  }, [activeTour, currentStepIndex, navigateToStep]);

  const prevStep = React.useCallback(() => {
    if (!activeTour || currentStepIndex <= 0) return;

    const prevIdx = currentStepIndex - 1;
    setCurrentStepIndex(prevIdx);
    navigateToStep(activeTour.steps[prevIdx]!);
  }, [activeTour, currentStepIndex, navigateToStep]);

  // Use refs so trigger has a stable identity (doesn't re-fire effects)
  const activeTourRef = React.useRef(activeTour);
  activeTourRef.current = activeTour;
  const completedToursRef = React.useRef(completedTours);
  completedToursRef.current = completedTours;

  const trigger = React.useCallback(
    (tour: TourDefinition) => {
      // Don't trigger if already running or already completed
      if (activeTourRef.current) return;
      if (completedToursRef.current.includes(tour.id)) return;

      startTour(tour);
    },
    [startTour],
  );

  const isTourCompleted = React.useCallback(
    (tourId: string) => completedTours.includes(tourId),
    [completedTours],
  );

  const resetTour = React.useCallback((tourId: string) => {
    unmarkTourCompleted(tourId);
    setCompletedTours((prev) => prev.filter((id) => id !== tourId));
  }, []);

  // Keyboard navigation
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
        prevStep();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRunning, dismissTour, nextStep, prevStep]);

  // Auto-trigger Welcome tour on home page for first-time visitors
  React.useEffect(() => {
    if (pathname !== "/") return;

    const t = setTimeout(() => {
      trigger(createWelcomeTour(isAuthed));
    }, 800);
    return () => clearTimeout(t);
  }, [pathname, trigger, isAuthed]);

  const value = React.useMemo<TourContextValue>(
    () => ({
      isRunning,
      activeTour,
      currentStep,
      currentStepIndex,
      totalSteps,
      startTour,
      nextStep,
      prevStep,
      dismissTour,
      trigger,
      isTourCompleted,
      resetTour,
    }),
    [
      isRunning,
      activeTour,
      currentStep,
      currentStepIndex,
      totalSteps,
      startTour,
      nextStep,
      prevStep,
      dismissTour,
      trigger,
      isTourCompleted,
      resetTour,
    ],
  );

  return (
    <TourContext.Provider value={value}>
      {children}
      <TourOverlay />
    </TourContext.Provider>
  );
}

/* ────────────────────────────
   Hook
──────────────────────────── */

export function useTour(): TourContextValue {
  const context = React.useContext(TourContext);
  if (!context) {
    throw new Error("useTour must be used within TourProvider");
  }
  return context;
}
