"use client";

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { AnimatePresence } from "motion/react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

import { cn } from "@/lib/utils";
import { apiGet } from "@/lib/api/client";
import { formatRelativeTime } from "@/lib/format";
import { sounds } from "@/lib/sounds";
import { ROUTES } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ProfileAvatar } from "@/components/common/profile-avatar";
import { Burst } from "@/components/ui/burst";
import { useAttestationQueue } from "./queue-provider";
import {
  ATTESTATION_TYPES,
  getAttributeByLabel,
  type AttestationType,
} from "@/lib/attestations/definitions";
import { AttestationBadge } from "@/components/attestation/badge";

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
  /** Size variant (network mode only) */
  size?: "xs" | "sm";
  /** Show "+N" count badges on each button (fetched automatically) */
  showCounts?: boolean;
  /** Show tooltip with attestor names on hover */
  showTooltip?: boolean;
  /**
   * Endorsement mode — pass skill/tool labels to render endorsable badges
   * instead of network attestation buttons.
   */
  items?: string[];
  /** Required with items — which endorsement type (SKILL_ENDORSE or TOOL_ENDORSE) */
  endorsementType?: "SKILL_ENDORSE" | "TOOL_ENDORSE";
  /** Whether this is the viewer's own profile (endorsement mode: read-only) */
  isSelf?: boolean;
};

type AttestorInfo = {
  id: string;
  name: string | null;
  handle: string | null;
  avatarUrl: string | null;
  createdAt: string;
};

type StatusResponse = {
  activeTypes: string[];
  receivedCountsByType: Record<string, number>;
  receivedUsersByType: Record<string, AttestorInfo[]>;
  endorsementCountsByAttribute: Record<string, number>;
  endorsementUsersByAttribute: Record<string, AttestorInfo[]>;
  viewerEndorsedAttributes: string[];
  viewerAttestationIds: Record<string, string>;
  viewerEndorsementIds: Record<string, string>;
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
  size = "sm",
  showCounts = false,
  showTooltip = false,
  items,
  endorsementType,
  isSelf = false,
}: AttestationButtonsProps) {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { createAttestation, retractAttestation, lastChangedAt } = useAttestationQueue();

  // Shared state
  const [burst, setBurst] = useState<{ emoji: string; rect: DOMRect; seed: number } | null>(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // Network mode state
  const [savingTypes, setSavingTypes] = useState<Set<AttestationType>>(new Set());
  const [activeTypes, setActiveTypes] = useState<Set<AttestationType>>(new Set());
  const [receivedCounts, setReceivedCounts] = useState<Record<string, number>>({});
  const [receivedUsers, setReceivedUsers] = useState<Record<string, AttestorInfo[]>>({});

  // Endorsement mode state
  const [endorsementCounts, setEndorsementCounts] = useState<Record<string, number>>({});
  const [endorsementUsers, setEndorsementUsers] = useState<Record<string, AttestorInfo[]>>({});
  const [viewerEndorsed, setViewerEndorsed] = useState<Set<string>>(new Set());
  const [savingAttributes, setSavingAttributes] = useState<Set<string>>(new Set());

  // ID maps for retraction (type/attributeId → attestation record ID)
  const [attestationIdsByType, setAttestationIdsByType] = useState<Record<string, string>>({});
  const [endorsementIdsByAttribute, setEndorsementIdsByAttribute] = useState<Record<string, string>>({});

  // Retraction in-progress tracking
  const [retractingTypes, setRetractingTypes] = useState<Set<AttestationType>>(new Set());
  const [retractingAttributes, setRetractingAttributes] = useState<Set<string>>(new Set());

  const currentUserId = session?.user?.id;
  const isSessionLoading = sessionStatus === "loading";
  const isEndorsementMode = !!items;

  // Fetch status on mount and when attestations change
  useEffect(() => {
    if (isSessionLoading) return;

    // Network mode: viewing own profile — no fetch needed (buttons hidden)
    if (!isEndorsementMode && currentUserId && currentUserId === toUserId) {
      setHasLoaded(true);
      return;
    }

    const controller = new AbortController();

    apiGet<StatusResponse>("/api/attestation/status", { toUserId }, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.ok) {
          // Network data
          setActiveTypes(new Set(
            result.value.activeTypes.filter(
              (t): t is AttestationType => t in ATTESTATION_TYPES
            )
          ));
          setReceivedCounts(result.value.receivedCountsByType ?? {});
          setReceivedUsers(result.value.receivedUsersByType ?? {});
          // Endorsement data
          setEndorsementCounts(result.value.endorsementCountsByAttribute ?? {});
          setEndorsementUsers(result.value.endorsementUsersByAttribute ?? {});
          setViewerEndorsed(new Set(result.value.viewerEndorsedAttributes ?? []));
          // ID maps for retraction
          setAttestationIdsByType(result.value.viewerAttestationIds ?? {});
          setEndorsementIdsByAttribute(result.value.viewerEndorsementIds ?? {});
        }
        setHasLoaded(true);
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setHasLoaded(true);
      });

    return () => controller.abort();
  }, [currentUserId, toUserId, lastChangedAt, isSessionLoading, isEndorsementMode]);

  // Don't show network buttons when viewing own profile
  if (!isEndorsementMode && currentUserId && currentUserId === toUserId) {
    return null;
  }

  const isLoading = isSessionLoading || !hasLoaded;

  /* ── Network attestation handler ── */

  const handleAttestClick = async (
    e: React.MouseEvent,
    type: AttestationType
  ) => {
    if (!currentUserId) {
      router.push(ROUTES.signIn);
      return;
    }

    if (savingTypes.has(type)) return;

    const rect = e.currentTarget.getBoundingClientRect();

    const emoji = ATTESTATION_TYPES[type]?.emoji;
    if (emoji) setBurst({ emoji, rect, seed: Date.now() });

    setSavingTypes((prev) => { const next = new Set(prev); next.add(type); return next; });
    sounds.select({ spatial: rect.left + rect.width / 2 });

    const result = await createAttestation({ toUserId, toName, toHandle, toAvatarUrl, type });

    if (result.ok) {
      setActiveTypes((prev) => { const next = new Set(prev); next.add(type); return next; });
      if (result.id) setAttestationIdsByType((prev) => ({ ...prev, [type]: result.id! }));
      setReceivedCounts((prev) => ({ ...prev, [type]: (prev[type] ?? 0) + 1 }));
    } else {
      sounds.error();
    }

    setSavingTypes((prev) => { const next = new Set(prev); next.delete(type); return next; });
  };

  /* ── Network retract handler ── */

  const handleRetractClick = async (
    e: React.MouseEvent,
    type: AttestationType
  ) => {
    const attestationId = attestationIdsByType[type];
    if (!attestationId || retractingTypes.has(type)) return;

    // Snapshot for rollback
    const prevCount = receivedCounts[type] ?? 0;

    // Optimistic update
    setRetractingTypes((prev) => { const next = new Set(prev); next.add(type); return next; });
    setActiveTypes((prev) => { const next = new Set(prev); next.delete(type); return next; });
    setReceivedCounts((prev) => ({ ...prev, [type]: Math.max(0, prevCount - 1) }));
    setAttestationIdsByType((prev) => { const { [type]: _, ...rest } = prev; return rest; });

    const rect = e.currentTarget.getBoundingClientRect();
    sounds.tap({ spatial: rect.left + rect.width / 2 });

    await retractAttestation(attestationId);

    // Note: retractAttestation in queue-provider handles its own rollback on failure
    // and bumps lastChangedAt which triggers a status re-fetch above.
    setRetractingTypes((prev) => { const next = new Set(prev); next.delete(type); return next; });
  };

  /* ── Endorsement handler ── */

  const handleEndorseClick = useCallback(async (
    e: React.MouseEvent,
    attributeId: string,
    type: AttestationType
  ) => {
    if (!currentUserId) {
      router.push(ROUTES.signIn);
      return;
    }

    if (savingAttributes.has(attributeId)) return;

    const rect = e.currentTarget.getBoundingClientRect();

    const emoji = ATTESTATION_TYPES[type]?.emoji;
    if (emoji) setBurst({ emoji, rect, seed: Date.now() });

    // Optimistic update
    setSavingAttributes((prev) => { const next = new Set(prev); next.add(attributeId); return next; });
    setViewerEndorsed((prev) => { const next = new Set(prev); next.add(attributeId); return next; });
    setEndorsementCounts((prev) => ({ ...prev, [attributeId]: (prev[attributeId] ?? 0) + 1 }));
    sounds.select({ spatial: rect.left + rect.width / 2 });

    const result = await createAttestation({
      toUserId,
      toName,
      toHandle,
      toAvatarUrl,
      type,
      attributeId,
    });

    if (result.ok) {
      if (result.id) setEndorsementIdsByAttribute((prev) => ({ ...prev, [attributeId]: result.id! }));
    } else {
      // Rollback
      setViewerEndorsed((prev) => { const next = new Set(prev); next.delete(attributeId); return next; });
      setEndorsementCounts((prev) => ({ ...prev, [attributeId]: (prev[attributeId] ?? 0) - 1 }));
      sounds.error();
    }

    setSavingAttributes((prev) => { const next = new Set(prev); next.delete(attributeId); return next; });
  }, [currentUserId, savingAttributes, toUserId, toName, toHandle, toAvatarUrl, createAttestation, router]);

  /* ── Endorsement retract handler ── */

  const handleRetractEndorsement = useCallback(async (
    e: React.MouseEvent,
    attributeId: string,
  ) => {
    const attestationId = endorsementIdsByAttribute[attributeId];
    if (!attestationId || retractingAttributes.has(attributeId)) return;

    // Snapshot for rollback
    const prevCount = endorsementCounts[attributeId] ?? 0;

    // Optimistic update
    setRetractingAttributes((prev) => { const next = new Set(prev); next.add(attributeId); return next; });
    setViewerEndorsed((prev) => { const next = new Set(prev); next.delete(attributeId); return next; });
    setEndorsementCounts((prev) => ({ ...prev, [attributeId]: Math.max(0, prevCount - 1) }));
    setEndorsementIdsByAttribute((prev) => { const { [attributeId]: _, ...rest } = prev; return rest; });

    const rect = e.currentTarget.getBoundingClientRect();
    sounds.tap({ spatial: rect.left + rect.width / 2 });

    await retractAttestation(attestationId);

    setRetractingAttributes((prev) => { const next = new Set(prev); next.delete(attributeId); return next; });
  }, [endorsementIdsByAttribute, retractingAttributes, endorsementCounts, retractAttestation]);

  /* ── Endorsement mode render ── */

  if (isEndorsementMode && endorsementType) {
    if (isLoading) {
      return (
        <div className={cn("flex flex-wrap gap-1.5", className)}>
          {items.map((label) => (
            <Button key={label} variant="secondary" size={size} disabled className="relative">
              <span className="invisible">{label}</span>
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="h-3 w-12 rounded-full bg-muted-foreground/20 animate-pulse" />
              </span>
            </Button>
          ))}
        </div>
      );
    }

    return (
      <>
        <div className={cn("flex flex-wrap gap-1.5", className)}>
          {items.map((label) => {
            const attribute = getAttributeByLabel(label);

            // No matching attribute in definitions — render disabled button
            if (!attribute) {
              return (
                <Button key={label} variant="secondary" size={size} disabled>
                  {label}
                </Button>
              );
            }

            const attributeId = attribute.id;
            const count = endorsementCounts[attributeId] ?? 0;
            const endorsed = viewerEndorsed.has(attributeId);
            const endorsers = endorsementUsers[attributeId] ?? [];
            const isSaving = savingAttributes.has(attributeId);
            const isRetracting = retractingAttributes.has(attributeId);
            const hasTooltipData = showTooltip && endorsers.length > 0;

            const buttonContent = (
              <>
                {label}
                {count > 0 && (
                  <span className="text-xs">+{count}</span>
                )}
              </>
            );

            const button = (() => {
              // Self profile — always read-only
              if (isSelf) {
                return (
                  <Button key={attributeId} variant="secondary" size={size} disabled>
                    {buttonContent}
                  </Button>
                );
              }

              // Retracting in progress
              if (isRetracting) {
                return (
                  <Button key={attributeId} variant="secondary" size={size} disabled>
                    {buttonContent}
                  </Button>
                );
              }

              // Already endorsed — secondary, hover shows destructive via CSS
              if (endorsed) {
                return (
                  <Button
                    key={attributeId}
                    variant="secondary"
                    size={size}
                    className="opacity-50 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                    onClick={(e) => handleRetractEndorsement(e, attributeId)}
                  >
                    {buttonContent}
                  </Button>
                );
              }

              // Saving (create in progress)
              if (isSaving) {
                return (
                  <Button key={attributeId} variant="default" size={size} disabled>
                    {buttonContent}
                  </Button>
                );
              }

              // Not endorsed — click to endorse
              return (
                <Button
                  key={attributeId}
                  variant="default"
                  size={size}
                  onClick={(e) => handleEndorseClick(e, attributeId, endorsementType)}
                >
                  {buttonContent}
                </Button>
              );
            })();

            if (!hasTooltipData) return button;

            return (
              <Tooltip key={attributeId}>
                <TooltipTrigger>
                  {button}
                </TooltipTrigger>
                <TooltipContent side="top" sideOffset={8}>
                  <AttestorTooltip attestors={endorsers} totalCount={count} />
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Emoji Burst Animation */}
        <AnimatePresence>
          {burst && (
            <BurstOverlay burst={burst} onDone={() => setBurst(null)} />
          )}
        </AnimatePresence>
      </>
    );
  }

  /* ── Network mode render ── */

  return (
    <>
      <div className={cn("flex flex-wrap gap-1.5", className)}>
        {Object.values(ATTESTATION_TYPES).filter((t) => t.id !== "SKILL_ENDORSE" && t.id !== "TOOL_ENDORSE").map((attestType) => {
          const type = attestType.id as AttestationType;
          const isSaving = savingTypes.has(type);
          const isActive = activeTypes.has(type);
          const isRetracting = retractingTypes.has(type);
          const count = showCounts ? (receivedCounts[type] ?? 0) : 0;
          const attestors = receivedUsers[type] ?? [];
          const totalCount = receivedCounts[type] ?? 0;
          const hasTooltip = showTooltip && attestors.length > 0;

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
                  <AttestationBadge type={attestType.id} bare showEmoji={false} />
                </span>
                <span className="absolute inset-0 flex items-center justify-center gap-2">
                  <span className="h-3 w-12 rounded-full bg-muted-foreground/20 animate-pulse" />
                </span>
              </Button>
            );
          }

          const buttonContent = (
            <>
              <AttestationBadge type={attestType.id} bare showEmoji={false} />
              {count > 0 && (
                <span className="text-xs">+{count}</span>
              )}
            </>
          );

          const button = (() => {
            // Retracting in progress
            if (isRetracting) {
              return (
                <Button key={attestType.id} variant="secondary" size={size} disabled>
                  {buttonContent}
                </Button>
              );
            }

            // Already attested — secondary, hover shows destructive via CSS
            if (isActive) {
              return (
                <Button
                  key={attestType.id}
                  variant="secondary"
                  size={size}
                  className="opacity-50 hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => handleRetractClick(e, type)}
                >
                  {buttonContent}
                </Button>
              );
            }

            // Saving (create in progress)
            if (isSaving) {
              return (
                <Button key={attestType.id} variant="default" size={size} disabled>
                  {buttonContent}
                </Button>
              );
            }

            // Not attested — click to attest
            return (
              <Button
                key={attestType.id}
                variant="default"
                size={size}
                onClick={(e) => handleAttestClick(e, type)}
              >
                {buttonContent}
              </Button>
            );
          })();

          if (!hasTooltip) return button;

          return (
            <Tooltip key={attestType.id}>
              <TooltipTrigger>
                {button}
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={8}>
                <AttestorTooltip attestors={attestors} totalCount={totalCount} />
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* Emoji Burst Animation */}
      <AnimatePresence>
        {burst && (
          <BurstOverlay burst={burst} onDone={() => setBurst(null)} />
        )}
      </AnimatePresence>
    </>
  );
}

/* ────────────────────────────
   Private sub-components
──────────────────────────── */

function AttestorTooltip({ attestors, totalCount }: { attestors: AttestorInfo[]; totalCount: number }) {
  return (
    <div className="flex flex-col gap-3 py-0.5">
      {attestors.map((u) => (
        <div key={u.id} className="flex items-center justify-between gap-4">
          <ProfileAvatar
            type="user"
            src={u.avatarUrl}
            name={u.name ?? u.handle ?? ""}
            size="sm"
            className="size-4"
          />
          <span className="text-xs text-white">
            {u.name ?? `@${u.handle}`}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatRelativeTime(u.createdAt)}
          </span>
        </div>
      ))}
      {totalCount > attestors.length && (
        <span className="text-xs text-muted-foreground">
          +{totalCount - attestors.length} more
        </span>
      )}
    </div>
  );
}

function BurstOverlay({ burst, onDone }: { burst: { emoji: string; rect: DOMRect; seed: number }; onDone: () => void }) {
  return (
    <div
      className="fixed z-[100] pointer-events-none"
      style={{
        left: burst.rect.left + burst.rect.width / 2,
        top: burst.rect.top + burst.rect.height / 2,
      }}
    >
      <Burst
        key={burst.seed}
        emoji={burst.emoji}
        onDone={onDone}
      />
    </div>
  );
}
