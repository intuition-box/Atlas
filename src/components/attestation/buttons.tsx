"use client";

import * as React from "react";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check } from "lucide-react";
import { useSession } from "next-auth/react";

import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";
import { ROUTES } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProfileAvatar } from "@/components/common/profile-avatar";
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
  /** Show "+N" count badges on each button (fetched automatically) */
  showCounts?: boolean;
  /** Show tooltip with attestor names on hover (requires showCounts) */
  showTooltip?: boolean;
};

type FlyingDot = {
  id: string;
  type: AttestationType;
  rect: DOMRect;
};

type AttestorInfo = {
  id: string;
  name: string | null;
  handle: string | null;
  avatarUrl: string | null;
};

type StatusResponse = {
  activeTypes: string[];
  receivedCountsByType: Record<string, number>;
  receivedUsersByType: Record<string, AttestorInfo[]>;
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
  showCounts = false,
  showTooltip = false,
}: AttestationButtonsProps) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [animatingTypes, setAnimatingTypes] = useState<Set<AttestationType>>(new Set());
  const [savingTypes, setSavingTypes] = useState<Set<AttestationType>>(new Set());
  const [flyingDots, setFlyingDots] = useState<FlyingDot[]>([]);
  const [activeTypes, setActiveTypes] = useState<Set<AttestationType>>(new Set());
  const [receivedCounts, setReceivedCounts] = useState<Record<string, number>>({});
  const [receivedUsers, setReceivedUsers] = useState<Record<string, AttestorInfo[]>>({});
  const [isFetching, setIsFetching] = useState(true);
  const { createAttestation, buttonRef, lastChangedAt } = useAttestationQueue();

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

  // Fetch status (active types + counts + attestors) on mount and when attestations change
  useEffect(() => {
    // Wait for session to load before deciding
    if (isSessionLoading) {
      return;
    }

    // Viewing own profile — no fetch needed (buttons hidden)
    if (currentUserId && currentUserId === toUserId) {
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
          setReceivedCounts(result.value.receivedCountsByType ?? {});
          setReceivedUsers(result.value.receivedUsersByType ?? {});
        }
        setIsFetching(false);
      })
      .catch(() => {
        // Don't update state if aborted (component unmounted or deps changed)
        if (controller.signal.aborted) return;
        setIsFetching(false);
      });

    return () => controller.abort();
  }, [currentUserId, toUserId, lastChangedAt, isSessionLoading]);

  // Don't show attestation buttons when viewing own profile
  if (currentUserId && currentUserId === toUserId) {
    return null;
  }

  const handleAttestClick = (
    e: React.MouseEvent,
    type: AttestationType
  ) => {
    // Redirect unauthenticated users to sign-in
    if (!currentUserId) {
      router.push(ROUTES.signIn);
      return;
    }

    if (animatingTypes.has(type) || savingTypes.has(type)) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const dotId = `${type}-${Date.now()}`;

    // Optimistically disable button
    setSavingTypes((prev) => {
      const next = new Set(prev);
      next.add(type);
      return next;
    });

    // Start button animation (shine)
    setAnimatingTypes((prev) => {
      const next = new Set(prev);
      next.add(type);
      return next;
    });

    // After shine delay, call API and spawn flying dot on success
    timeoutsRef.current.push(
      window.setTimeout(async () => {
        const result = await createAttestation({ toUserId, toName, toHandle, toAvatarUrl, type });

        if (result.ok) {
          // Spawn flying dot and play sound on success
          setFlyingDots((prev) => [...prev, { id: dotId, type, rect }]);
          sounds.select({ spatial: rect.left + rect.width / 2 });

          // Remove flying dot after flight
          timeoutsRef.current.push(
            window.setTimeout(() => {
              setFlyingDots((prev) => prev.filter((d) => d.id !== dotId));
            }, ANIMATION.dotLifetime - ANIMATION.shineDelay)
          );
        } else {
          sounds.error();
        }

        // Clear saving state
        setSavingTypes((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }, ANIMATION.shineDelay)
    );

    // Clean up shine animation state
    timeoutsRef.current.push(
      window.setTimeout(() => {
        setAnimatingTypes((prev) => {
          const next = new Set(prev);
          next.delete(type);
          return next;
        });
      }, ANIMATION.shineCleanup)
    );
  };

  const isLoading = isSessionLoading || isFetching;

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {Object.values(ATTESTATION_TYPES).map((attestType) => {
          const type = attestType.id as AttestationType;
          const isAnimating = animatingTypes.has(type);
          const isSaving = savingTypes.has(type);
          const isActive = activeTypes.has(type);
          const count = showCounts ? (receivedCounts[type] ?? 0) : 0;
          const attestors = receivedUsers[type] ?? [];
          const totalCount = receivedCounts[type] ?? 0;
          const hasTooltip = showTooltip && attestors.length > 0;

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

          const buttonContent = (
            <>
              <AttestationBadge type={attestType.id} bare />
              {count > 0 && (
                <span className="text-xs text-muted-foreground">+{count}</span>
              )}
            </>
          );

          const button = isActive || isSaving ? (
            <Button
              key={attestType.id}
              variant="secondary"
              size={size}
              disabled
            >
              {buttonContent}
            </Button>
          ) : (
            <Button
              key={attestType.id}
              variant="default"
              size={size}
              onClick={(e) => handleAttestClick(e, type)}
            >
              {buttonContent}
            </Button>
          );

          if (!hasTooltip) return button;

          return (
            <Tooltip key={attestType.id}>
              <TooltipTrigger>
                {button}
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <div className="flex flex-col gap-1.5 py-0.5">
                  {attestors.map((u) => (
                    <div key={u.id} className="flex items-center gap-2">
                      <ProfileAvatar
                        type="user"
                        src={u.avatarUrl}
                        name={u.name ?? u.handle ?? ""}
                        size="sm"
                        className="size-4"
                      />
                      <span className="text-xs">
                        {u.name ?? `@${u.handle}`}
                      </span>
                    </div>
                  ))}
                  {totalCount > attestors.length && (
                    <span className="text-xs text-muted-foreground/60">
                      +{totalCount - attestors.length} more
                    </span>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
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
