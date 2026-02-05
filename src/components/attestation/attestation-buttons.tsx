"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Link2 } from "lucide-react";
import { useSession } from "next-auth/react";

import { cn } from "@/lib/utils";
import { apiGet, apiPost } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAttestationQueue } from "./attestation-queue-provider";
import { ATTESTATION_TYPES, type AttestationType } from "@/config/attestations";

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

type ActiveAttestation = {
  type: string;
  mintedAt: string | null;
};

type StatusResponse = {
  activeTypes: string[];
  activeAttestations: ActiveAttestation[];
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
  const { data: session } = useSession();
  const [animatingTypes, setAnimatingTypes] = useState<Set<AttestationType>>(new Set());
  const [flyingDots, setFlyingDots] = useState<FlyingDot[]>([]);
  const [activeTypes, setActiveTypes] = useState<Set<AttestationType>>(new Set());
  const [mintedTypes, setMintedTypes] = useState<Set<AttestationType>>(new Set());
  const [retractingTypes, setRetractingTypes] = useState<Set<AttestationType>>(new Set());
  const { addToQueue, isInQueue, buttonRef, lastSavedAt } = useAttestationQueue();

  const currentUserId = session?.user?.id;

  // Fetch existing attestations on mount and when attestations are saved
  useEffect(() => {
    if (!currentUserId || currentUserId === toUserId) return;

    const controller = new AbortController();

    apiGet<StatusResponse>("/api/attestation/status", { toUserId }, { signal: controller.signal })
      .then((result) => {
        if (result.ok) {
          setActiveTypes(new Set(result.value.activeTypes as AttestationType[]));
          // Track which attestations are minted onchain
          const minted = new Set<AttestationType>();
          for (const att of result.value.activeAttestations) {
            if (att.mintedAt) {
              minted.add(att.type as AttestationType);
            }
          }
          setMintedTypes(minted);
        }
      })
      .catch(() => {
        // Ignore errors (e.g., aborted)
      });

    return () => controller.abort();
  }, [currentUserId, toUserId, lastSavedAt]);

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
    setAnimatingTypes((prev) => new Set(prev).add(type));

    // After button "shine", spawn flying dot and add to queue
    setTimeout(() => {
      setFlyingDots((prev) => [...prev, { id, type, rect }]);
      addToQueue({ toUserId, toName, toHandle, toAvatarUrl, type });
    }, 250);

    // Clean up animation state
    setTimeout(() => {
      setAnimatingTypes((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }, 300);

    // Remove flying dot after flight
    setTimeout(() => {
      setFlyingDots((prev) => prev.filter((d) => d.id !== id));
    }, 800);
  };

  const handleRetractClick = async (type: AttestationType) => {
    if (retractingTypes.has(type)) return;

    setRetractingTypes((prev) => new Set(prev).add(type));

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
                <TooltipTrigger asChild>
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
                <TooltipTrigger asChild>
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
                duration: 0.45,
                ease: [0.32, 0, 0.15, 1],
                left: { duration: 0.45, ease: [0.32, 0, 0.15, 1] },
                top: { duration: 0.45, ease: [0.0, 0.55, 0.35, 1] },
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
