"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Link2 } from "lucide-react";
import { useSession } from "next-auth/react";

import { cn } from "@/lib/utils";
import { apiGet, apiPost } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAttestationQueue } from "./attestation-queue-provider";
import { ATTESTATION_TYPES, type AttestationType } from "@/lib/attestations/definitions";

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
  /** Show retract button for active attestations */
  allowRetract?: boolean;
};

type FlyingDot = {
  id: string;
  type: AttestationType;
  rect: DOMRect;
};

type StatusResponse = {
  activeTypes: string[];
  activeAttestations: Array<{ type: string; mintedAt: string | null }>;
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
  allowRetract = false,
}: AttestationButtonsProps) {
  const { data: session, status: sessionStatus } = useSession();
  const [animatingTypes, setAnimatingTypes] = useState<Set<AttestationType>>(new Set());
  const [flyingDots, setFlyingDots] = useState<FlyingDot[]>([]);
  const [activeTypes, setActiveTypes] = useState<Set<AttestationType>>(new Set());
  const [mintedTypes, setMintedTypes] = useState<Set<AttestationType>>(new Set());
  const [retractingTypes, setRetractingTypes] = useState<Set<AttestationType>>(new Set());
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
        if (result.ok) {
          const active = new Set(
            result.value.activeTypes.filter(
              (t): t is AttestationType => t in ATTESTATION_TYPES
            )
          );
          const minted = new Set<AttestationType>();
          for (const att of result.value.activeAttestations) {
            if (att.mintedAt && att.type in ATTESTATION_TYPES) {
              minted.add(att.type as AttestationType);
            }
          }
          setActiveTypes(active);
          setMintedTypes(minted);
        }
      })
      .catch(() => {
        // Ignore errors (e.g., aborted)
      })
      .finally(() => {
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

  const handleRetractClick = async (type: AttestationType) => {
    if (retractingTypes.has(type)) return;

    setRetractingTypes((prev) => {
      const next = new Set(prev);
      next.add(type);
      return next;
    });

    try {
      // First, we need to find the attestation ID
      // For now, we'll use the list endpoint to get it
      const listResult = await apiGet<{
        attestations: Array<{ id: string; type: string }>;
      }>("/api/attestation/list", {
        fromUserId: currentUserId,
        toUserId,
        type,
        take: "1",
      });

      if (!listResult.ok || listResult.value.attestations.length === 0) {
        return;
      }

      const attestationId = listResult.value.attestations[0]!.id;

      const result = await apiPost<{ alreadyRevoked: boolean }>(
        "/api/attestation/retract",
        { attestationId }
      );

      if (result.ok) {
        setActiveTypes((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }
    } finally {
      setRetractingTypes((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }
  };

  // Show buttons with spinner while loading (no layout shift)
  if (isSessionLoading || isFetching) {
    return (
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {Object.values(ATTESTATION_TYPES).map((attestType) => (
          <Button
            key={attestType.id}
            variant="outline"
            size={size}
            disabled
          >
            <Spinner className="size-3 mr-1" />
            {attestType.label}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <>
      {/* Attestation Type Buttons */}
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {Object.values(ATTESTATION_TYPES).map((attestType) => {
          const type = attestType.id as AttestationType;
          const inQueue = isInQueue(toUserId, type);
          const isAnimating = animatingTypes.has(type);
          const isActive = activeTypes.has(type);
          const isMinted = mintedTypes.has(type);
          const isRetracting = retractingTypes.has(type);

          // If already attested and we allow retract, show retract button
          if (isActive && allowRetract) {
            return (
              <Tooltip key={attestType.id}>
                <TooltipTrigger>
                  <Button
                    variant="outline"
                    size={size}
                    onClick={() => handleRetractClick(type)}
                    disabled={isRetracting}
                    className={cn(
                      "transition-colors duration-200",
                      "bg-primary/10 text-primary border-primary/30",
                      "hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                    )}
                  >
                    {isMinted ? (
                      <Link2 className="size-3 mr-1" />
                    ) : (
                      <Check className="size-3 mr-1" />
                    )}
                    {attestType.label}
                    {isRetracting && (
                      <span className="ml-1 animate-pulse">...</span>
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    {isMinted ? "Onchain - Click to retract" : "Click to retract"}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          }

          // If already attested (no retract), show as active/disabled
          if (isActive) {
            return (
              <Tooltip key={attestType.id}>
                <TooltipTrigger>
                  <Button
                    variant="outline"
                    size={size}
                    disabled
                    className={cn(
                      "cursor-default",
                      isMinted
                        ? "bg-primary/15 text-primary border-primary/40"
                        : "bg-primary/10 text-primary border-primary/30"
                    )}
                  >
                    {isMinted ? (
                      <Link2 className="size-3 mr-1" />
                    ) : (
                      <Check className="size-3 mr-1" />
                    )}
                    {attestType.label}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-xs">
                    {isMinted ? "Attested onchain" : "Already attested"}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          }

          // Normal button (not attested yet)
          return (
            <Button
              key={attestType.id}
              variant="outline"
              size={size}
              onClick={(e) => handleAttestClick(e, type)}
              disabled={inQueue}
              className={cn(
                "transition-colors duration-200",
                isAnimating && "bg-primary text-primary-foreground border-primary",
                inQueue && "bg-primary/10 text-primary border-primary/30"
              )}
            >
              {attestType.label}
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
