"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { OrbitCanvas } from "./orbit-canvas";
import { useOrbitSimulation } from "./use-orbit-simulation";
import type { OrbitViewProps, SimulatedNode, TooltipState } from "./types";
import { Spinner } from "../ui/spinner";
import { INTERACTION } from "./constants";

/* ────────────────────────────
   Tooltip Component
──────────────────────────── */

const LEVEL_LABELS = {
  ADVOCATE: "Advocate",
  CONTRIBUTOR: "Contributor",
  PARTICIPANT: "Participant",
  EXPLORER: "Explorer",
} as const;

const LEVEL_BADGE_COLORS = {
  ADVOCATE: "bg-blue-500",
  CONTRIBUTOR: "bg-sky-400",
  PARTICIPANT: "bg-slate-300",
  EXPLORER: "bg-slate-500",
} as const;

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

type MemberTooltipProps = {
  node: SimulatedNode;
  x: number;
  y: number;
  containerRect: DOMRect;
};

function MemberTooltip({ node, x, y, containerRect }: MemberTooltipProps) {
  const tooltipWidth = 260;
  const tooltipHeight = 140;
  const padding = 12;

  // Calculate position relative to container
  let left = x - containerRect.left + 16;
  let top = y - containerRect.top + 16;

  // Avoid overflow
  if (left + tooltipWidth > containerRect.width - padding) {
    left = x - containerRect.left - tooltipWidth - 16;
  }
  if (top + tooltipHeight > containerRect.height - padding) {
    top = y - containerRect.top - tooltipHeight - 16;
  }
  if (left < padding) left = padding;
  if (top < padding) top = padding;

  const lastActive = formatRelativeTime(node.lastActiveAt);

  return (
    <div
      className="pointer-events-none absolute z-50 w-[260px] rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur-md"
      style={{ left, top }}
    >
      <div className="flex items-start gap-3">
        <Avatar className="size-10 rounded-lg">
          <AvatarImage src={node.avatarUrl ?? ""} alt={node.name} />
          <AvatarFallback className="rounded-lg text-xs">{initials(node.name)}</AvatarFallback>
        </Avatar>

        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground">{node.name}</div>
          {node.headline && (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{node.headline}</div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-white ${LEVEL_BADGE_COLORS[node.orbitLevel]}`}
        >
          {LEVEL_LABELS[node.orbitLevel]}
        </span>
        <span className="text-xs text-muted-foreground">Reach: {node.reachScore}</span>
      </div>

      {node.tags && node.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {node.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {node.tags.length > 4 && (
            <span className="text-[10px] text-muted-foreground">+{node.tags.length - 4}</span>
          )}
        </div>
      )}

      {lastActive && <div className="mt-2 text-[10px] text-muted-foreground">{lastActive}</div>}
    </div>
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
  onMemberClick,
  className = "",
}: OrbitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [tooltip, setTooltip] = useState<TooltipState>(null);
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

  // Handle node click
  const handleNodeClick = useCallback(
    (node: SimulatedNode) => {
      if (onMemberClick) {
        onMemberClick(node.id);
      }
    },
    [onMemberClick]
  );

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
      {tooltip && containerRect && (
        <MemberTooltip
          node={tooltip.node}
          x={tooltip.x}
          y={tooltip.y}
          containerRect={containerRect}
        />
      )}
    </div>
  );
}
