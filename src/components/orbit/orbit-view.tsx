"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

import { OrbitCanvas } from "./orbit-canvas";
import { useOrbitSimulation } from "./use-orbit-simulation";
import type { OrbitViewProps, SimulatedNode, TooltipState } from "./types";
import { Spinner } from "../ui/spinner";
import { INTERACTION } from "./constants";
import { AttestationButtons } from "@/components/attestation/attestation-buttons";

/* ────────────────────────────
   Helpers
──────────────────────────── */

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)).toUpperCase();
}

function formatRelativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;

  const diff = Date.now() - ts;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Active today";
  if (days === 1) return "Active yesterday";
  if (days < 7) return `Active ${days} days ago`;
  if (days < 30) return `Active ${Math.floor(days / 7)} weeks ago`;
  if (days < 365) return `Active ${Math.floor(days / 30)} months ago`;
  return `Active ${Math.floor(days / 365)} years ago`;
}

/* ────────────────────────────
   Tooltip Component (simplified)
──────────────────────────── */

type MemberTooltipProps = {
  node: SimulatedNode;
  x: number;
  y: number;
  containerRect: DOMRect;
};

function MemberTooltip({ node, x, y, containerRect }: MemberTooltipProps) {
  const padding = 12;

  let left = x - containerRect.left + 16;
  let top = y - containerRect.top + 16;

  if (left + 120 > containerRect.width - padding) {
    left = x - containerRect.left - 120 - 16;
  }
  if (top + 60 > containerRect.height - padding) {
    top = y - containerRect.top - 60 - 16;
  }
  if (left < padding) left = padding;
  if (top < padding) top = padding;

  return (
    <div
      className="pointer-events-none absolute z-50 rounded-lg border border-border bg-background/95 px-3 py-2 shadow-lg backdrop-blur-md"
      style={{ left, top }}
    >
      <div className="text-sm font-medium text-foreground">{node.name}</div>
      <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
        <span>Love: {node.loveScore}</span>
        <span>Reach: {node.reachScore}</span>
      </div>
    </div>
  );
}

/* ────────────────────────────
   User Profile Card (for Popover)
──────────────────────────── */

type UserProfileCardProps = {
  node: SimulatedNode;
  onViewProfile: () => void;
};

function UserProfileCard({ node, onViewProfile }: UserProfileCardProps) {
  const lastActive = formatRelativeTime(node.lastActiveAt);

  return (
    <>
      {/* Avatar */}
      <div className="flex justify-center">
        <Avatar className="size-16">
          <AvatarImage src={node.avatarUrl ?? ""} alt={node.name} />
          <AvatarFallback className="text-lg">{initials(node.name)}</AvatarFallback>
        </Avatar>
      </div>

      {/* Name & Handle */}
      <div className="text-center">
        <div className="text-base font-semibold text-foreground">{node.name}</div>
        {node.handle && (
          <div className="text-sm text-muted-foreground">@{node.handle}</div>
        )}
      </div>

      {/* Details */}
      {(lastActive || node.location) && (
        <div className="space-y-1 text-sm text-muted-foreground text-center">
          {lastActive && <div>{lastActive}</div>}
          {node.location && <div>{node.location}</div>}
        </div>
      )}

      {/* Attestation Buttons */}
      <AttestationButtons
        toUserId={node.id}
        toName={node.name}
        toHandle={node.handle}
        toAvatarUrl={node.avatarUrl}
        className="justify-center"
      />

      {/* Profile Button */}
      <Button size="sm" variant="outline" className="w-full" onClick={onViewProfile}>
        View Profile
      </Button>
    </>
  );
}

/* ────────────────────────────
   Main OrbitView Component
──────────────────────────── */

export function OrbitView({
  members,
  links = [],
  centerLogoUrl,
  centerName,
  isMembershipOpen,
  isPublicDirectory,
  onMemberClick,
  onMemberAttest,
  className = "",
}: OrbitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [popover, setPopover] = useState<{ node: SimulatedNode; x: number; y: number } | null>(null);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);


  // Track container size with debouncing to prevent resize animation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;

    const updateSize = () => {
      const rect = container.getBoundingClientRect();
      const w = Math.round(rect.width);
      const h = Math.round(rect.height);

      // Only update if size actually changed (rounded to avoid sub-pixel jitter)
      setContainerSize((prev) => {
        if (prev.width === w && prev.height === h) {
          return prev;
        }
        return { width: w, height: h };
      });
      setContainerRect(rect);
    };

    // Initial size - immediate
    updateSize();

    const observer = new ResizeObserver(() => {
      // Debounce resize events
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(updateSize, 50);
    });

    observer.observe(container);
    return () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      observer.disconnect();
    };
  }, []);

  // Initialize simulation
  const { nodes, links: simulatedLinks, updateNodePosition, unpinNode, setRotationPaused } = useOrbitSimulation({
    members,
    links,
    width: containerSize.width,
    height: containerSize.height,
  });

  // Rotation pause logic with 3-second resume delay
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNodeHoverChange = useCallback(
    (isHovering: boolean) => {
      // Clear any pending resume timeout
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
        resumeTimeoutRef.current = null;
      }

      if (isHovering) {
        // Pause immediately when hovering a node
        setRotationPaused(true);
      } else {
        // Resume after delay when hover ends
        resumeTimeoutRef.current = setTimeout(() => {
          setRotationPaused(false);
          resumeTimeoutRef.current = null;
        }, INTERACTION.RESUME_ROTATION_DELAY);
      }
    },
    [setRotationPaused]
  );

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, []);

  // Track if we're actually dragging (moved more than a few pixels)
  const isDraggingRef = useRef(false);

  // Handle node drag
  const handleNodeDragStart = useCallback(
    (_nodeId: string) => {
      // Don't do anything on start - wait until actual drag movement
      isDraggingRef.current = false;
    },
    []
  );

  const handleNodeDrag = useCallback(
    (nodeId: string, x: number, y: number) => {
      isDraggingRef.current = true;
      updateNodePosition(nodeId, x, y, true);
    },
    [updateNodePosition]
  );

  const handleNodeDragEnd = useCallback(
    (nodeId: string) => {
      // Only unpin if we actually dragged
      if (isDraggingRef.current) {
        unpinNode(nodeId);
      }
      isDraggingRef.current = false;
    },
    [unpinNode]
  );

  // Handle node hover
  const handleNodeHover = useCallback(
    (node: SimulatedNode | null, position: { x: number; y: number }) => {
      if (node) {
        setTooltip({ node, x: position.x, y: position.y });
      } else {
        setTooltip(null);
      }
    },
    []
  );

  // Handle node click - open popover
  const handleNodeClick = useCallback(
    (node: SimulatedNode, position: { x: number; y: number }) => {
      if (!isDraggingRef.current) {
        setPopover({ node, x: position.x, y: position.y });
        setTooltip(null);
      }
    },
    []
  );

  // Handle popover actions
  const handleClosePopover = useCallback(() => {
    setPopover(null);
  }, []);

  const handleViewProfile = useCallback(() => {
    if (popover) {
      onMemberClick?.(popover.node.id);
      setPopover(null);
    }
  }, [popover, onMemberClick]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ width: "100vw", height: "100vh" }}
    >
      {containerSize.width > 0 && containerSize.height > 0 ? (
        <OrbitCanvas
          nodes={nodes}
          links={simulatedLinks}
          width={containerSize.width}
          height={containerSize.height}
          centerLogoUrl={centerLogoUrl}
          centerName={centerName}
          isMembershipOpen={isMembershipOpen}
          isPublicDirectory={isPublicDirectory}
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onNodeDragStart={handleNodeDragStart}
          onNodeDrag={handleNodeDrag}
          onNodeDragEnd={handleNodeDragEnd}
          onNodeHoverChange={handleNodeHoverChange}
        />
      ) : (
        <Spinner />
      )}

      {/* Tooltip */}
      {tooltip && containerRect && !popover && (
        <MemberTooltip
          node={tooltip.node}
          x={tooltip.x}
          y={tooltip.y}
          containerRect={containerRect}
        />
      )}

      {/* User Profile Popover */}
      {popover && (
        <>
          <div className="fixed inset-0 z-40" onClick={handleClosePopover} />
          <div
            className="fixed z-50 w-72 rounded-2xl border border-border bg-popover p-4 shadow-2xl flex flex-col gap-4"
            style={{
              left: Math.min(popover.x, window.innerWidth - 300),
              top: Math.min(popover.y + 10, window.innerHeight - 280),
            }}
          >
            <UserProfileCard
              node={popover.node}
              onViewProfile={handleViewProfile}
            />
          </div>
        </>
      )}
    </div>
  );
}
