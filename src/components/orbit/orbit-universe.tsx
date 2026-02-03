"use client";

import * as React from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  type Simulation,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

import { UsersIcon, UserIcon, CheckIcon, PlusIcon } from "@/components/ui/icons";

/* ────────────────────────────
   Types
──────────────────────────── */

export type OrbitCommunity = {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string | null;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  orbitStats: {
    advocates: number;
    contributors: number;
    participants: number;
    explorers: number;
    dominantLevel: "advocates" | "contributors" | "participants" | "explorers";
  };
};

export type OrbitLink = {
  source: string;
  target: string;
  sharedMembers: number;
};

interface SimNode extends SimulationNodeDatum {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string | null;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  color: string;
  radius: number;
  image?: HTMLImageElement;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  sharedMembers: number;
}

type TooltipData = {
  name: string;
  handle: string;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  x: number;
  y: number;
};

/* ────────────────────────────
   Props
──────────────────────────── */

interface OrbitUniverseProps {
  communities: OrbitCommunity[];
  links?: OrbitLink[];
  hrefFor?: (c: OrbitCommunity) => string;
  onSelect?: (c: OrbitCommunity) => void;
  className?: string;
  style?: React.CSSProperties;
}

/* ────────────────────────────
   Constants
──────────────────────────── */

const MIN_RADIUS = 14;
const MAX_RADIUS = 44;

// Colors by dominant orbit level
const ORBIT_COLORS = {
  advocates: "#3b82f6",     // Blue
  contributors: "#60a5fa",  // Lighter blue
  participants: "#ffffff",  // White
  explorers: "#9ca3af",     // Grey
};

/* ────────────────────────────
   Helpers
──────────────────────────── */

function computeRadius(memberCount: number, maxMembers: number): number {
  if (maxMembers <= 0 || memberCount <= 0) return MIN_RADIUS;
  const t = Math.sqrt(memberCount / maxMembers);
  return MIN_RADIUS + t * (MAX_RADIUS - MIN_RADIUS);
}

/* ────────────────────────────
   Tooltip Component
──────────────────────────── */

function Tooltip({ data }: { data: TooltipData }) {
  return (
    <div
      style={{
        position: "absolute",
        left: data.x + 16,
        top: data.y + 16,
        pointerEvents: "none",
        padding: "12px 14px",
        borderRadius: 10,
        backdropFilter: "blur(12px)",
        background: "rgba(0, 0, 0, 0.75)",
        color: "rgba(255, 255, 255, 0.95)",
        fontSize: 13,
        lineHeight: "20px",
        minWidth: 180,
        maxWidth: 280,
        boxShadow: "0 4px 16px rgba(0, 0, 0, 0.4)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{data.name}</div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, opacity: 0.85 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UsersIcon style={{ width: 14, height: 14, flexShrink: 0 }} />
          <span>{data.memberCount} {data.memberCount === 1 ? "member" : "members"}</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <UserIcon style={{ width: 14, height: 14, flexShrink: 0 }} />
          <span>{data.isPublic ? "Public" : "Private"} community</span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {data.isMembershipOpen ? (
            <CheckIcon style={{ width: 14, height: 14, flexShrink: 0 }} />
          ) : (
            <PlusIcon style={{ width: 14, height: 14, flexShrink: 0 }} />
          )}
          <span>{data.isMembershipOpen ? "Open" : "Closed"} membership</span>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────
   Component
──────────────────────────── */

export function OrbitUniverse({
  communities,
  links = [],
  hrefFor,
  onSelect,
  className,
  style,
}: OrbitUniverseProps) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  // All mutable state in a single ref
  const stateRef = React.useRef({
    simulation: null as Simulation<SimNode, SimLink> | null,
    nodes: [] as SimNode[],
    links: [] as SimLink[],
    width: 0,
    height: 0,
    dpr: 1,
    transform: { x: 0, y: 0, k: 1 },
    draggedNode: null as SimNode | null,
    dragStart: null as { x: number; y: number } | null,
    pointer: { x: 0, y: 0, inside: false },
    hoveredNode: null as SimNode | null,
    tooltip: null as TooltipData | null,
    raf: null as number | null,
    lastCommunityIds: "",
    imageCache: new Map<string, HTMLImageElement>(),
    initialized: false,
    fadeIn: 0, // 0 to 1 for fade-in animation
    startTime: 0,
    linkDirections: [] as boolean[], // true = source->target, false = target->source (randomized)
  });

  const [tooltipData, setTooltipData] = React.useState<TooltipData | null>(null);

  // Stable references to props
  const onSelectRef = React.useRef(onSelect);
  const hrefForRef = React.useRef(hrefFor);
  onSelectRef.current = onSelect;
  hrefForRef.current = hrefFor;

  /* ────────────────────────────
     Load images
  ──────────────────────────── */

  const loadImage = React.useCallback((url: string): Promise<HTMLImageElement | null> => {
    const state = stateRef.current;
    const cached = state.imageCache.get(url);
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve) => {
      const img = new Image();
      // Don't set crossOrigin - allows loading from any origin
      // Canvas will be tainted but we don't need to export it
      img.onload = () => {
        state.imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = () => {
        // Image failed to load - don't cache, return null
        resolve(null);
      };
      img.src = url;
    });
  }, []);

  /* ────────────────────────────
     Initialize/update simulation
  ──────────────────────────── */

  const initializeSimulation = React.useCallback(() => {
    const state = stateRef.current;
    const { width, height } = state;

    // Don't initialize until we have actual dimensions
    if (width === 0 || height === 0 || communities.length === 0) return;

    const newIds = communities.map((c) => c.id).join(",");
    if (newIds === state.lastCommunityIds && state.nodes.length > 0) {
      return;
    }
    state.lastCommunityIds = newIds;

    const maxMembers = Math.max(1, ...communities.map((c) => c.memberCount));

    // Create nodes with initial positions near center
    const centerX = width / 2;
    const centerY = height / 2;

    const newNodes: SimNode[] = communities.map((c, i) => {
      const dominantLevel = c.orbitStats?.dominantLevel ?? "explorers";
      const color = ORBIT_COLORS[dominantLevel];
      const radius = computeRadius(c.memberCount, maxMembers);

      // Start nodes in a circle around the center to avoid the slide-in glitch
      const angle = (i / communities.length) * Math.PI * 2;
      const spread = Math.min(width, height) * 0.15;

      return {
        id: c.id,
        handle: c.handle,
        name: c.name,
        avatarUrl: c.avatarUrl ?? null,
        memberCount: c.memberCount,
        isPublic: c.isPublic,
        isMembershipOpen: c.isMembershipOpen,
        color,
        radius,
        x: centerX + Math.cos(angle) * spread,
        y: centerY + Math.sin(angle) * spread,
      };
    });

    state.nodes = newNodes;

    // Load avatar images
    for (const node of newNodes) {
      if (node.avatarUrl) {
        loadImage(node.avatarUrl).then((img) => {
          if (img) {
            node.image = img;
          }
        });
      }
    }

    // Create links
    const nodeIds = new Set(newNodes.map((n) => n.id));
    const newLinks: SimLink[] = links
      .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
      .map((l) => ({
        source: l.source as unknown as SimNode,
        target: l.target as unknown as SimNode,
        sharedMembers: l.sharedMembers,
      }));

    state.links = newLinks;

    // Randomize link directions (which bubble the bridge grows from)
    state.linkDirections = newLinks.map(() => Math.random() > 0.5);

    // Stop existing simulation
    state.simulation?.stop();

    // Create new simulation - increased charge strength for more spacing
    const sim = forceSimulation<SimNode>(newNodes)
      .force("link", forceLink<SimNode, SimLink>(newLinks).id((d) => d.id).distance(120))
      .force("charge", forceManyBody().strength(-350))
      .force("x", forceX(width / 2).strength(0.04))
      .force("y", forceY(height / 2).strength(0.04))
      .force("collide", forceCollide<SimNode>().radius((d) => d.radius + 12).strength(1));

    state.simulation = sim;

    // Start fade-in animation
    if (!state.initialized) {
      state.initialized = true;
      state.startTime = performance.now();
      state.fadeIn = 0;
    }
  }, [communities, links, loadImage]);

  // Try to initialize when communities change
  React.useEffect(() => {
    initializeSimulation();
  }, [initializeSimulation]);

  /* ────────────────────────────
     Canvas setup and resize
  ──────────────────────────── */

  React.useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const state = stateRef.current;

    const handleResize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));

      const isFirstResize = state.width === 0 && state.height === 0;

      state.width = width;
      state.height = height;
      state.dpr = dpr;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // On first resize, initialize simulation. On subsequent resizes, just update forces.
      if (isFirstResize) {
        initializeSimulation();
      } else {
        const sim = state.simulation;
        if (sim) {
          sim.force("x", forceX(width / 2).strength(0.04));
          sim.force("y", forceY(height / 2).strength(0.04));
          // Don't restart alpha - avoid the zoom-out animation
        }
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    handleResize();

    return () => ro.disconnect();
  }, [initializeSimulation]);

  /* ────────────────────────────
     Animation loop
  ──────────────────────────── */

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const state = stateRef.current;
    let running = true;

    const screenToWorld = (sx: number, sy: number) => {
      const t = state.transform;
      return {
        x: (sx - t.x) / t.k,
        y: (sy - t.y) / t.k,
      };
    };

    const pickNode = (sx: number, sy: number): SimNode | null => {
      const world = screenToWorld(sx, sy);

      for (let i = state.nodes.length - 1; i >= 0; i--) {
        const n = state.nodes[i];
        if (n.x === undefined || n.y === undefined) continue;

        const dx = n.x - world.x;
        const dy = n.y - world.y;
        const dist2 = dx * dx + dy * dy;

        if (dist2 <= n.radius * n.radius) {
          return n;
        }
      }
      return null;
    };

    const draw = () => {
      const { width, height, transform: t, nodes, links: simLinks, hoveredNode, linkDirections } = state;

      const elapsed = performance.now() - state.startTime;

      // Animation timing:
      // 0-600ms: bubbles fade in
      // 600-1400ms: bridges grow (800ms duration)
      const bubbleFadeDuration = 600;
      const bridgeGrowDelay = bubbleFadeDuration;
      const bridgeGrowDuration = 800;

      // Update fade-in animation
      if (state.initialized && state.fadeIn < 1) {
        state.fadeIn = Math.min(1, elapsed / bubbleFadeDuration);
      }

      // Bridge growth progress (0 to 1, starts after bubbles fade in)
      const bridgeProgress = state.initialized
        ? Math.max(0, Math.min(1, (elapsed - bridgeGrowDelay) / bridgeGrowDuration))
        : 0;

      // Easing function for smooth bridge growth
      const easeOutCubic = (x: number) => 1 - Math.pow(1 - x, 3);
      const easedBridgeProgress = easeOutCubic(bridgeProgress);

      const bubbleOpacity = state.fadeIn;

      ctx.clearRect(0, 0, width, height);

      // Don't draw anything until initialized
      if (!state.initialized || bubbleOpacity === 0) return;

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Draw links FIRST (behind nodes) - only after bubbles have faded in
      if (bridgeProgress > 0) {
        for (let i = 0; i < simLinks.length; i++) {
          const link = simLinks[i];
          const s = link.source as SimNode;
          const tgt = link.target as SimNode;
          if (s.x === undefined || s.y === undefined || tgt.x === undefined || tgt.y === undefined) continue;

          // Determine direction based on randomized linkDirections
          const reversed = linkDirections[i] ?? false;
          const startNode = reversed ? tgt : s;
          const endNode = reversed ? s : tgt;

          const dx = endNode.x - startNode.x;
          const dy = endNode.y - startNode.y;

          // Draw partial line based on bridge progress
          const currentEndX = startNode.x + dx * easedBridgeProgress;
          const currentEndY = startNode.y + dy * easedBridgeProgress;

          ctx.beginPath();
          ctx.moveTo(startNode.x, startNode.y);
          ctx.lineTo(currentEndX, currentEndY);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
          ctx.lineWidth = 1.5 / t.k;
          ctx.stroke();
        }
      }

      // Draw nodes with fade-in
      ctx.globalAlpha = bubbleOpacity;

      for (const n of nodes) {
        if (n.x === undefined || n.y === undefined) continue;

        const isHovered = hoveredNode?.id === n.id;
        const radius = isHovered ? n.radius * 1.1 : n.radius;

        // Draw circle background
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();

        // Draw avatar image if loaded
        if (n.image && n.image.complete && n.image.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(n.image, n.x - radius, n.y - radius, radius * 2, radius * 2);
          ctx.restore();
        }

        // Draw border
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = (isHovered ? 3 : 1.5) / t.k;
        ctx.stroke();
      }

      ctx.restore();
    };

    const tick = () => {
      if (!running) return;

      const ptr = state.pointer;
      if (ptr.inside && !state.draggedNode) {
        const picked = pickNode(ptr.x, ptr.y);
        const prevHovered = state.hoveredNode;

        if (picked !== prevHovered) {
          state.hoveredNode = picked;
          if (picked) {
            const newTooltip: TooltipData = {
              name: picked.name,
              handle: picked.handle,
              memberCount: picked.memberCount,
              isPublic: picked.isPublic,
              isMembershipOpen: picked.isMembershipOpen,
              x: ptr.x,
              y: ptr.y,
            };
            state.tooltip = newTooltip;
            setTooltipData(newTooltip);
          } else {
            state.tooltip = null;
            setTooltipData(null);
          }
        } else if (picked && state.tooltip) {
          state.tooltip.x = ptr.x;
          state.tooltip.y = ptr.y;
          setTooltipData({ ...state.tooltip });
        }
      }

      draw();
      state.raf = requestAnimationFrame(tick);
    };

    state.raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (state.raf) cancelAnimationFrame(state.raf);
    };
  }, []);

  /* ────────────────────────────
     Event handlers
  ──────────────────────────── */

  const onPointerMove = React.useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    state.pointer = { x, y, inside: true };

    if (state.draggedNode) {
      const t = state.transform;
      state.draggedNode.fx = (x - t.x) / t.k;
      state.draggedNode.fy = (y - t.y) / t.k;
    }
  }, []);

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);

    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const t = state.transform;
    const wx = (x - t.x) / t.k;
    const wy = (y - t.y) / t.k;

    for (let i = state.nodes.length - 1; i >= 0; i--) {
      const n = state.nodes[i];
      if (n.x === undefined || n.y === undefined) continue;

      const dx = n.x - wx;
      const dy = n.y - wy;
      if (dx * dx + dy * dy <= n.radius * n.radius) {
        state.draggedNode = n;
        state.dragStart = { x: n.x, y: n.y };
        n.fx = n.x;
        n.fy = n.y;

        // Hide tooltip during drag
        state.hoveredNode = null;
        state.tooltip = null;
        setTooltipData(null);

        state.simulation?.alphaTarget(0.3).restart();
        return;
      }
    }
  }, []);

  const onPointerUp = React.useCallback((e: React.PointerEvent) => {
    const state = stateRef.current;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const draggedNode = state.draggedNode;
    const dragStart = state.dragStart;

    if (draggedNode && dragStart) {
      const dx = (draggedNode.x ?? 0) - dragStart.x;
      const dy = (draggedNode.y ?? 0) - dragStart.y;
      const moved = Math.hypot(dx, dy);

      // Keep node pinned where it was dropped (don't reset fx/fy)
      // This allows free positioning like the d3 example
      state.simulation?.alphaTarget(0);
      state.draggedNode = null;
      state.dragStart = null;

      if (moved < 5) {
        // It was a click, not a drag - unpin so it can be clicked again
        draggedNode.fx = null;
        draggedNode.fy = null;
        const t = state.transform;
        const wx = (x - t.x) / t.k;
        const wy = (y - t.y) / t.k;

        for (let i = state.nodes.length - 1; i >= 0; i--) {
          const n = state.nodes[i];
          if (n.x === undefined || n.y === undefined) continue;

          const ndx = n.x - wx;
          const ndy = n.y - wy;
          if (ndx * ndx + ndy * ndy <= n.radius * n.radius) {
            const onSelect = onSelectRef.current;
            const hrefFor = hrefForRef.current;

            const community = communities.find((c) => c.id === n.id);
            if (community) {
              if (onSelect) {
                onSelect(community);
              } else {
                const href = hrefFor ? hrefFor(community) : `/c/${n.handle}`;
                window.location.assign(href);
              }
            }
            break;
          }
        }
      }
    }

    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, [communities]);

  const onPointerLeave = React.useCallback(() => {
    const state = stateRef.current;
    state.pointer.inside = false;
    if (state.hoveredNode) {
      state.hoveredNode = null;
      state.tooltip = null;
      setTooltipData(null);
    }
  }, []);

  const onWheel = React.useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    const state = stateRef.current;
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const t = state.transform;
    const delta = -e.deltaY;
    const scaleFactor = delta > 0 ? 1.1 : 0.9;
    const newK = Math.max(0.1, Math.min(10, t.k * scaleFactor));

    const wx = (x - t.x) / t.k;
    const wy = (y - t.y) / t.k;

    state.transform = {
      k: newK,
      x: x - wx * newK,
      y: y - wy * newK,
    };
  }, []);

  /* ────────────────────────────
     JSX
  ──────────────────────────── */

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        ...style,
      }}
    >
      <canvas
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor: stateRef.current.hoveredNode ? "pointer" : "default",
        }}
        aria-label="Community universe"
        role="img"
      />

      {tooltipData && <Tooltip data={tooltipData} />}
    </div>
  );
}
