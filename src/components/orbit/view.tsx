"use client";

import { useEffect, useRef, useState, useCallback } from "react";

import { OrbitCanvas } from "./canvas";
import { NodeTooltip, NodePopover } from "./node-popover";
import { useOrbitSimulation } from "./simulation";
import type { OrbitViewProps, SimulatedNode } from "./types";

type TooltipState = {
  node: SimulatedNode;
  x: number;
  y: number;
} | null;

type PopoverState = {
  node: SimulatedNode;
  x: number;
  y: number;
} | null;

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
  const mouseInsideRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sim = useOrbitSimulation(members, links, size.w / 2, size.h / 2);

  const handleNodeHover = useCallback(
    (node: SimulatedNode | null, screenPos: { x: number; y: number }) => {
      if (node) {
        setTooltip({ node, x: screenPos.x, y: screenPos.y });
      } else {
        setTooltip(null);
      }
    },
    [],
  );

  const handleNodeClick = useCallback(
    (node: SimulatedNode, screenPos: { x: number; y: number }) => {
      setPopover({ node, x: screenPos.x, y: screenPos.y });
      setTooltip(null);
      sim.setPaused(true);
    },
    [sim],
  );

  const handleClosePopover = useCallback(() => {
    setPopover(null);
    // Only unpause if mouse is outside the container
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

  const containerRect = containerRef.current?.getBoundingClientRect();

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ width: "100vw", height: "100vh" }}
      onMouseEnter={() => { mouseInsideRef.current = true; sim.setPaused(true); }}
      onMouseLeave={() => { mouseInsideRef.current = false; if (!popover) sim.setPaused(false); }}
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
      {tooltip && containerRect && !popover && (
        <NodeTooltip
          node={tooltip.node}
          x={tooltip.x}
          y={tooltip.y}
          containerRect={containerRect}
        />
      )}

      {/* Popover — click */}
      {popover && (
        <NodePopover
          node={popover.node}
          x={popover.x}
          y={popover.y}
          onClose={handleClosePopover}
          onViewProfile={handleViewProfile}
        />
      )}
    </div>
  );
}
