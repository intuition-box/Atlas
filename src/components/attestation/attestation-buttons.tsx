"use client";

import * as React from "react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check } from "lucide-react";
import { useSession } from "next-auth/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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
};

type FlyingDot = {
  id: string;
  type: AttestationType;
  rect: DOMRect;
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
  const { data: session } = useSession();
  const [animatingTypes, setAnimatingTypes] = useState<Set<AttestationType>>(new Set());
  const [flyingDots, setFlyingDots] = useState<FlyingDot[]>([]);
  const { addToQueue, isInQueue, buttonRef } = useAttestationQueue();

  // Don't show attestation buttons for yourself
  const currentUserId = session?.user?.id;
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

  return (
    <>
      {/* Attestation Type Buttons */}
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {Object.values(ATTESTATION_TYPES).map((attestType) => {
          const type = attestType.id as AttestationType;
          const inQueue = isInQueue(toUserId, type);
          const isAnimating = animatingTypes.has(type);

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
