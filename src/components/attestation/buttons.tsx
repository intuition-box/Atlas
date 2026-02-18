"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check } from "lucide-react";
import { useSession } from "next-auth/react";

import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";
import { Button } from "@/components/ui/button";
import { useAttestationQueue } from "./queue-provider";
import { ATTESTATION_TYPES, type AttestationType } from "@/lib/attestations/definitions";
import { AttestationBadge } from "@/components/attestation/badge";

const ANIMATION = {
  shineDelay: 250,
  shineCleanup: 300,
  dotLifetime: 800,
  flightDuration: 0.45,
};

/* ────────────────────────────
   Types
──────────────────────────── */

type AttestationButtonsProps = {
  /** Target user ID to attest */
  toUserId: string;
  /** Target user display name */
  toName: string;
  /** Target user handle (optional) */
  toHandle?: string;
  /** Target user avatar URL (optional) */
  toAvatarUrl?: string | null;
  /** Optional className for the container */
  className?: string;
  /** Size variant */
  size?: "xs" | "sm";
};

type FlyingDot = {
  id: string;
  type: AttestationType;
  rect: DOMRect;
};

type StatusResponse = {
  activeTypes: string[];
};

/* ────────────────────────────
   Component
──────────────────────────── */

export function AttestationButtons({
  toUserId,
  toName,
  toHandle,
  toAvatarUrl,
  className,
  size = "xs",
}: AttestationButtonsProps) {
  const { data: session, status: sessionStatus } = useSession();
  const [animatingTypes, setAnimatingTypes] = useState<Set<AttestationType>>(new Set());
  const [flyingDots, setFlyingDots] = useState<FlyingDot[]>([]);
  const [activeTypes, setActiveTypes] = useState<Set<AttestationType>>(new Set());
  const [isFetching, setIsFetching] = useState(true);
  const { addToQueue, isInQueue, buttonRef, lastSavedAt } = useAttestationQueue();

  const timeoutsRef = React.useRef<number[]>([]);

  useEffect(() => {
    return () => {
      timeoutsRef.current.forEach(clearTimeout);
      timeoutsRef.current = [];
      setFlyingDots([]);
    };
  }, []);

  const currentUserId = session?.user?.id;
  const isSessionLoading = sessionStatus === "loading";

  // Fetch existing attestations on mount and when attestations are saved
  useEffect(() => {
    // Wait for session to load before deciding
    if (isSessionLoading) {
      return;
    }

    // No session or viewing own profile - no fetch needed
    if (!currentUserId || currentUserId === toUserId) {
      setIsFetching(false);
      return;
    }

    setIsFetching(true);
    const controller = new AbortController();

    apiGet<StatusResponse>("/api/attestation/status", { toUserId }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          setActiveTypes(new Set(
            result.value.activeTypes.filter(
              (t): t is AttestationType => t in ATTESTATION_TYPES
            )
          ));
        }
        setIsFetching(false);
      })
      .catch(() => {
        // Don't update state if aborted (component unmounted or deps changed)
        if (controller.signal.aborted) return;
        setIsFetching(false);
      });

    return () => controller.abort();
  }, [currentUserId, toUserId, lastSavedAt, isSessionLoading]);

  // Don't show attestation buttons for yourself
  if (currentUserId === toUserId) {
    return null;
  }

  const handleAttestClick = (
    e: React.MouseEvent,
    type: AttestationType
  ) => {
    if (animatingTypes.has(type)) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const id = `${type}-${Date.now()}`;

    // Start button animation
    setAnimatingTypes((prev) => {
      const next = new Set(prev);
      next.add(type);
      return next;
    });

    // After button "shine", spawn flying dot and add to queue
    timeoutsRef.current.push(
      window.setTimeout(() => {
        setFlyingDots((prev) => [...prev, { id, type, rect }]);
        addToQueue({ toUserId, toName, toHandle, toAvatarUrl, type });
        sounds.select({ spatial: rect.left + rect.width / 2 });
      }, ANIMATION.shineDelay)
    );

    // Clean up animation state
    timeoutsRef.current.push(
      window.setTimeout(() => {
        setAnimatingTypes((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }, ANIMATION.shineCleanup)
    );

    // Remove flying dot after flight
    timeoutsRef.current.push(
      window.setTimeout(() => {
        setFlyingDots((prev) => prev.filter((d) => d.id !== id));
      }, ANIMATION.dotLifetime)
    );
  };

  const isLoading = isSessionLoading || isFetching;

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {Object.values(ATTESTATION_TYPES).map((attestType) => {
          const type = attestType.id as AttestationType;
          const inQueue = isInQueue(toUserId, type);
          const isAnimating = animatingTypes.has(type);
          const isActive = activeTypes.has(type);

          // 1. Loading — all buttons disabled with skeleton
          if (isLoading) {
            return (
              <Button
                key={attestType.id}
                variant="secondary"
                size={size}
                disabled
                className="relative"
              >
                <span className="invisible">
                  <AttestationBadge type={attestType.id} bare />
                </span>
                <span className="absolute inset-0 flex items-center justify-center gap-2">
                  <span className="size-3.5 rounded-full bg-muted-foreground/20 animate-pulse" />
                  <span className="h-3 w-12 rounded-full bg-muted-foreground/20 animate-pulse" />
                </span>
              </Button>
            );
          }

          // 2. Already attested — stays disabled, green
          if (isActive) {
            return (
              <Button
                key={attestType.id}
                variant="secondary"
                size={size}
                disabled
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
              >
                <AttestationBadge type={attestType.id} bare />
              </Button>
            );
          }

          // 3. Available — enabled
          return (
            <Button
              key={attestType.id}
              variant="secondary"
              size={size}
              onClick={(e) => handleAttestClick(e, type)}
              disabled={inQueue}
              className={cn(
                "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20 hover:border-emerald-500/40 transition-colors duration-200",
                inQueue && "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
              )}
            >
              <AttestationBadge type={attestType.id} bare />
            </Button>
          );
        })}
      </div>

      {/* Flying Dot Animation */}
      <AnimatePresence>
        {flyingDots.map((dot) => {
          const targetRect = buttonRef?.current?.getBoundingClientRect();
          if (!targetRect) return null;

          const endX = targetRect.left + targetRect.width / 2;
          const endY = targetRect.top + targetRect.height / 2;

          return (
            <motion.div
              key={dot.id}
              className="fixed z-[100] pointer-events-none"
              initial={{
                left: dot.rect.left + dot.rect.width / 2 - 12,
                top: dot.rect.top + dot.rect.height / 2 - 12,
                width: 24,
                height: 24,
                opacity: 1,
                scale: 1,
              }}
              animate={{
                left: endX - 10,
                top: endY - 10,
                width: 20,
                height: 20,
                opacity: 1,
                scale: 1,
              }}
              exit={{
                opacity: 0,
                scale: 0,
              }}
              transition={{
                duration: ANIMATION.flightDuration,
                ease: [0.32, 0, 0.15, 1],
                left: { duration: ANIMATION.flightDuration, ease: [0.32, 0, 0.15, 1] },
                top: { duration: ANIMATION.flightDuration, ease: [0.0, 0.55, 0.35, 1] },
              }}
            >
              <div className="w-full h-full rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/50">
                <Check className="size-3" strokeWidth={3} />
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </>
  );
}
