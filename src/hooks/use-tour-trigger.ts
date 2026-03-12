"use client";

import { useEffect } from "react";

import { useTour } from "@/components/tour/tour-provider";
import type { TourDefinition } from "@/components/tour/tour-definitions";

/**
 * Convenience hook to trigger a tour on mount.
 *
 * No-ops if the tour is already completed or another tour is running.
 * Pass `null` to skip (e.g. when a condition isn't met).
 *
 * @example
 * ```tsx
 * const tour = useMemo(() => !isSelf ? createFirstEndorsementTour() : null, [isSelf]);
 * useTourTrigger(tour);
 * ```
 */
export function useTourTrigger(tour: TourDefinition | null): void {
  const { trigger } = useTour();

  useEffect(() => {
    if (!tour) return;
    // Small delay to let the page render before starting the tour
    const t = setTimeout(() => trigger(tour), 600);
    return () => clearTimeout(t);
  }, [tour, trigger]);
}
