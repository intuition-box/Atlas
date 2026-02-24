"use client";

import { useEffect, useRef, useState, useCallback } from "react";

import { sounds } from "@/lib/sounds";

import { OrbitCanvas } from "./canvas";
import {
  NodeTooltip,
  NodePopover,
  CommunityTooltipContent,
  MemberTooltipContent,
  MemberPopoverContent,
  CommunityPopoverContent,
  type CommunityPopoverData,
} from "./node-popover";
import { useOrbitSimulation } from "./simulation";
import type { OrbitViewProps, SimulatedNode } from "./types";

type ScreenPos = { x: number; y: number; screenRadius: number };

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

type CenterPopoverState = {
  x: number;
  y: number;
  screenRadius: number;
} | null;

type CommunityTooltipState = {
  x: number;
  y: number;
  screenRadius: number;
} | null;

export function OrbitView({
  members,
  links = [],
  centerLogoUrl,
  centerName,
  isMembershipOpen,
  isPublicDirectory,
  community,
  startFromCenter = false,
  onMemberClick,
  className = "",
}: OrbitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const [popover, setPopover] = useState<PopoverState>(null);
  const [centerPopover, setCenterPopover] = useState<CenterPopoverState>(null);
  const [communityTooltip, setCommunityTooltip] = useState<CommunityTooltipState>(null);
  // Tracks pointer presence independently of React state to avoid rerenders
  const mouseInsideRef = useRef(false);
  // Track if drum sound already played (only once per mount)
  const drumPlayedRef = useRef(false);

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

  // During initial mount size is 0; simulation handles center (0,0) safely
  const sim = useOrbitSimulation(
    members,
    links,
    size.w / 2,
    size.h / 2,
    startFromCenter,
  );

  // Play drum sound when orbit first has nodes (matches scene.tsx)
  useEffect(() => {
    if (sim.nodes.length > 0 && !drumPlayedRef.current) {
      drumPlayedRef.current = true;
      sounds.play("drum");
    }
  }, [sim.nodes.length]);

  /* ────────────────────────────
     Cursor — derived from React state so it re-renders
     (matches scene.tsx pattern — no imperative canvas.style.cursor)
  ──────────────────────────── */

  const hasAnyPopover = !!popover || !!centerPopover;
  const cursor = (tooltip || communityTooltip) ? "pointer" : "grab";

  /* ────────────────────────────
     Node hover
  ──────────────────────────── */

  const handleNodeHover = useCallback(
    (node: SimulatedNode | null, screenPos: ScreenPos) => {
      if (node) {
        sounds.play("hover");
        setTooltip({ node, x: screenPos.x, y: screenPos.y, screenRadius: screenPos.screenRadius });
      } else {
        setTooltip(null);
      }
    },
    [],
  );

  /* ────────────────────────────
     Center avatar hover
  ──────────────────────────── */

  const handleCenterHover = useCallback(
    (hovered: boolean, screenPos: ScreenPos) => {
      if (hovered) {
        sounds.play("hover");
        setCommunityTooltip(screenPos);
      } else {
        setCommunityTooltip(null);
      }
    },
    [],
  );

  /* ────────────────────────────
     Drag start — clear tooltips (matches scene.tsx pointerDown)
  ──────────────────────────── */

  const handleDragStart = useCallback(() => {
    setTooltip(null);
    setCommunityTooltip(null);
  }, []);

  /* ────────────────────────────
     Node click
  ──────────────────────────── */

  const handleNodeClick = useCallback(
    (node: SimulatedNode, screenPos: ScreenPos) => {
      setPopover({ node, x: screenPos.x, y: screenPos.y, screenRadius: screenPos.screenRadius });
      setTooltip(null);
      setCommunityTooltip(null);
      setCenterPopover(null);
      sim.setPaused(true);
    },
    [sim],
  );

  /* ────────────────────────────
     Center click
  ──────────────────────────── */

  const handleCenterClick = useCallback(
    (screenPos: ScreenPos) => {
      setCenterPopover(screenPos);
      setPopover(null);
      setTooltip(null);
      setCommunityTooltip(null);
      sim.setPaused(true);
    },
    [sim],
  );

  /* ────────────────────────────
     Close popover handlers
  ──────────────────────────── */

  const handleClosePopover = useCallback(() => {
    setPopover(null);
    // Resume only when pointer is outside to avoid instant re-pause
    if (!mouseInsideRef.current) {
      sim.setPaused(false);
    }
  }, [sim]);

  const handleCloseCenterPopover = useCallback(() => {
    setCenterPopover(null);
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

  /* ────────────────────────────
     Mouse enter/leave — pause/resume orbit
  ──────────────────────────── */

  const handleMouseEnter = useCallback(() => {
    mouseInsideRef.current = true;
    sim.setPaused(true);
  }, [sim]);

  const handleMouseLeave = useCallback(() => {
    mouseInsideRef.current = false;
    if (!popover && !centerPopover) {
      sim.setPaused(false);
    }
  }, [sim, popover, centerPopover]);

  // When navigating from the homepage universe, the pointer is already
  // inside the container on mount so mouseenter never fires. Detect
  // presence on the first pointermove instead.
  const handlePointerMoveContainer = useCallback(() => {
    if (!mouseInsideRef.current) {
      mouseInsideRef.current = true;
      sim.setPaused(true);
    }
  }, [sim]);

  /* ────────────────────────────
     Build community popover data from props
  ──────────────────────────── */

  const communityPopoverData: CommunityPopoverData | null = community
    ? {
        id: community.id,
        handle: community.handle,
        name: community.name,
        avatarUrl: community.avatarUrl,
        memberCount: community.memberCount,
        isPublic: community.isPublic,
        isMembershipOpen: community.isMembershipOpen,
        orbitStats: { advocates: 0, contributors: 0, participants: 0, explorers: 0 },
        description: community.description,
        viewerMembership: community.viewerMembership ?? null,
      }
    : null;

  // Count orbit stats from members
  if (communityPopoverData) {
    for (const m of members) {
      switch (m.orbitLevel) {
        case "ADVOCATE": communityPopoverData.orbitStats.advocates++; break;
        case "CONTRIBUTOR": communityPopoverData.orbitStats.contributors++; break;
        case "PARTICIPANT": communityPopoverData.orbitStats.participants++; break;
        case "EXPLORER": communityPopoverData.orbitStats.explorers++; break;
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      // Size is controlled by parent; canvas adapts via ResizeObserver
      style={{ width: "100%", height: "100%", cursor }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onPointerMove={handlePointerMoveContainer}
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
          onDragStart={handleDragStart}
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
          onCenterHover={community ? handleCenterHover : undefined}
          onCenterClick={community ? handleCenterClick : undefined}
        />
      )}

      {/* Community tooltip — hover on center avatar */}
      {communityTooltip && !hasAnyPopover && community && (
        <NodeTooltip
          x={communityTooltip.x}
          y={communityTooltip.y}
          screenRadius={communityTooltip.screenRadius}
          className="min-w-[180px] max-w-[280px]"
        >
          <CommunityTooltipContent
            name={community.name}
            memberCount={community.memberCount}
            isPublic={community.isPublic}
            isMembershipOpen={community.isMembershipOpen}
          />
        </NodeTooltip>
      )}

      {/* Member tooltip — hover on member nodes */}
      {tooltip && !hasAnyPopover && (
        <NodeTooltip
          x={tooltip.x}
          y={tooltip.y}
          screenRadius={tooltip.screenRadius}
        >
          <MemberTooltipContent node={tooltip.node} />
        </NodeTooltip>
      )}

      {/* Member popover — click on member node */}
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

      {/* Community popover — click on center avatar */}
      {centerPopover && communityPopoverData && (
        <NodePopover
          x={centerPopover.x}
          y={centerPopover.y}
          screenRadius={centerPopover.screenRadius}
          onClose={handleCloseCenterPopover}
        >
          <CommunityPopoverContent community={communityPopoverData} />
        </NodePopover>
      )}
    </div>
  );
}
