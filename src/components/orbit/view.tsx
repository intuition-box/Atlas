"use client";

import { useEffect, useRef, useState, useCallback } from "react";

import { OrbitCanvas } from "./canvas";
import { NodeTooltip, NodePopover, MemberTooltipContent, MemberPopoverContent } from "./node-popover";
import { useOrbitSimulation } from "./simulation";
import type { OrbitViewProps, SimulatedNode } from "./types";

type TooltipState = {
  node: SimulatedNode;
  x: number;
  y: number;
  screenRadius: number;
} | null;

type PopoverState = {
  node: SimulatedNode;
  x: number;
  y: number;
  screenRadius: number;
} | null;

// Cached layout rect for future hit-testing / overlay alignment
const containerRectRef = useRef<DOMRect | null>(null);

export function OrbitView({
  members,
  links = [],
  centerLogoUrl,
  centerName,
  isMembershipOpen,
  isPublicDirectory,
  onMemberClick,
  className = "",
}: OrbitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [popover, setPopover] = useState<PopoverState>(null);
  // Tracks pointer presence independently of React state to avoid rerenders
  const mouseInsideRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
      containerRectRef.current = r;
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // During initial mount size is 0; simulation handles center (0,0) safely
  const sim = useOrbitSimulation(
    members,
    links,
    size.w / 2,
    size.h / 2,
  );

  const handleNodeHover = useCallback(
    (node: SimulatedNode | null, screenPos: { x: number; y: number; screenRadius: number }) => {
      if (node) {
        setTooltip({ node, x: screenPos.x, y: screenPos.y, screenRadius: screenPos.screenRadius });
      } else {
        setTooltip(null);
      }
    },
    [],
  );

  const handleNodeClick = useCallback(
    (node: SimulatedNode, screenPos: { x: number; y: number; screenRadius: number }) => {
      setPopover({ node, x: screenPos.x, y: screenPos.y, screenRadius: screenPos.screenRadius });
      setTooltip(null);
      sim.setPaused(true);
      // Ensure hover tooltip never reappears while popover is active
    },
    [sim],
  );

  const handleClosePopover = useCallback(() => {
    setPopover(null);
    // Resume only when pointer is outside to avoid instant re-pause
    if (!mouseInsideRef.current) {
      sim.setPaused(false);
    }
  }, [sim]);

  const handleViewProfile = useCallback(
    (memberId: string) => {
      setPopover(null);
      onMemberClick?.(memberId);
    },
    [onMemberClick],
  );

  const handleMouseEnter = useCallback(() => {
    mouseInsideRef.current = true;
    sim.setPaused(true);
  }, [sim]);

  const handleMouseLeave = useCallback(() => {
    mouseInsideRef.current = false;
    if (!popover) {
      sim.setPaused(false);
    }
  }, [sim, popover]);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      // Size is controlled by parent; canvas adapts via ResizeObserver
      style={{ width: "100%", height: "100%" }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {size.w > 0 && size.h > 0 && (
        <OrbitCanvas
          width={size.w}
          height={size.h}
          nodes={sim.nodes}
          centerLogoUrl={centerLogoUrl}
          centerName={centerName}
          onDrag={sim.updateNodePosition}
          onDragEnd={sim.releaseNode}
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
        />
      )}

      {/* Tooltip — hover only, hidden when popover is open */}
      {tooltip && !popover && (
        <NodeTooltip
          x={tooltip.x}
          y={tooltip.y}
          screenRadius={tooltip.screenRadius}
        >
          <MemberTooltipContent node={tooltip.node} />
        </NodeTooltip>
      )}

      {/* Popover — click */}
      {popover && (
        <NodePopover
          x={popover.x}
          y={popover.y}
          screenRadius={popover.screenRadius}
          onClose={handleClosePopover}
        >
          <MemberPopoverContent
            node={popover.node}
            onViewProfile={handleViewProfile}
          />
        </NodePopover>
      )}
    </div>
  );
}
