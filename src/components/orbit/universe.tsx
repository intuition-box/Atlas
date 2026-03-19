"use client";
/* eslint-disable react-compiler/react-compiler */
// Opted out of React Compiler: the render effect (canvas draw loop) captures
// only refs and must run exactly once. The compiler re-evaluates its deps on
// every re-render, tearing down and rebuilding the canvas — causing flicker.

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

import { apiGet } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";

import {
  NodeTooltip,
  CommunityTooltipContent,
} from "./node-popover";
import { UNIVERSE, ORBIT_LEVELS_COLORS, ENERGY_FLOW, CONNECTION_PHYSICS } from "./constants";
import type { OrbitCommunity, OrbitLink } from "./types";

/* ────────────────────────────
   Internal Types
──────────────────────────── */

interface UniverseNode extends SimulationNodeDatum {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  color: string;
  radius: number;
  orbitStats: {
    advocates: number;
    contributors: number;
    participants: number;
    explorers: number;
  };
}

interface UniverseLink extends SimulationLinkDatum<UniverseNode> {
  sharedMembers: number;
}

type Transform = { x: number; y: number; k: number };

type CommunityTooltipData = {
  name: string;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  x: number;
  y: number;
  screenRadius: number;
};

type UniverseMode = "idle" | "zoom-in" | "waiting";

/** Physics-simulated midpoint for connection line behavior */
interface ConnectionMidpoint {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/* ────────────────────────────
   Helpers
──────────────────────────── */

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

/** Parse "#rrggbb" hex color to [r, g, b] tuple */
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const ORBIT_LEVELS = ["advocates", "contributors", "participants", "explorers"] as const;

/** Determine the dominant orbit level from combined stats */
function dominantOrbitLevel(stats: {
  advocates: number;
  contributors: number;
  participants: number;
  explorers: number;
}): string {
  let best = "explorers";
  let max = -1;
  for (const level of ORBIT_LEVELS) {
    if (stats[level] > max) {
      max = stats[level];
      best = level;
    }
  }
  return best;
}

function computeUniverseRadius(memberCount: number, maxMembers: number): number {
  if (maxMembers <= 0 || memberCount <= 0) return UNIVERSE.MIN_RADIUS;
  const t = Math.sqrt(memberCount / maxMembers);
  return UNIVERSE.MIN_RADIUS + t * (UNIVERSE.MAX_RADIUS - UNIVERSE.MIN_RADIUS);
}

/* ────────────────────────────
   Image cache
──────────────────────────── */

class ImageCache {
  private cache = new Map<string, HTMLImageElement | null>();
  private loading = new Set<string>();
  onLoad: (() => void) | null = null;

  get(url: string | null): HTMLImageElement | null | undefined {
    if (!url) return null;
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;
    if (this.loading.has(url)) return undefined;

    this.loading.add(url);
    const img = new Image();
    img.src = url;
    img.onload = () => {
      this.loading.delete(url);
      this.cache.set(url, img);
      this.onLoad?.();
    };
    img.onerror = () => {
      this.loading.delete(url);
      this.cache.set(url, null);
      this.onLoad?.();
    };
    return undefined;
  }
}

/* ────────────────────────────
   Props
──────────────────────────── */

export interface UniverseViewProps {
  communities: OrbitCommunity[];
  links?: OrbitLink[];
  /** Called when zoom-in animation completes on a community. Parent does router.push. */
  onCommunityClick?: (handle: string) => void;
  /** When set, renders an invisible DOM anchor positioned over this community node.
   *  Useful for guided-tour spotlights that need a real element to target. */
  highlightHandle?: string;
  className?: string;
  style?: React.CSSProperties;
}

/* ────────────────────────────
   Component
──────────────────────────── */

export function UniverseView({
  communities,
  links = [],
  onCommunityClick,
  highlightHandle,
  className,
  style,
}: UniverseViewProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const highlightAnchorRef = React.useRef<HTMLDivElement>(null);
  const highlightHandleRef = React.useRef(highlightHandle);
  highlightHandleRef.current = highlightHandle;

  const stateRef = React.useRef({
    // Canvas dimensions
    width: 0,
    height: 0,
    dpr: 1,

    // Mode
    mode: "idle" as UniverseMode,

    // Transform (camera state)
    transform: { x: 0, y: 0, k: 1 } as Transform,

    // Simulation
    simulation: null as Simulation<UniverseNode, UniverseLink> | null,
    nodes: [] as UniverseNode[],
    links: [] as UniverseLink[],
    linkDirections: [] as boolean[],
    connectionMidpoints: [] as ConnectionMidpoint[],
    lastPhysicsTime: 0,
    initialized: false,
    startTime: 0,
    fadeIn: 0,
    lastCommunityIds: "",

    // Zoom transition
    transition: {
      startTime: 0,
      transformFrom: { x: 0, y: 0, k: 1 } as Transform,
      transformTo: { x: 0, y: 0, k: 1 } as Transform,
      targetNode: null as UniverseNode | null,
      targetHandle: "",
    },

    // Image cache
    imageCache: new ImageCache(),

    // Prefetch
    fetchDone: false,

    // Pointer
    draggedNode: null as UniverseNode | null,
    dragStart: null as { x: number; y: number } | null,
    pointerStartScreen: null as { x: number; y: number } | null,
    wasDrag: false,
    pendingTapNodeId: null as string | null,
    hoveredNode: null as UniverseNode | null,
  });

  // React state for tooltip (needs re-render for positioning)
  const [communityTooltip, setCommunityTooltip] =
    React.useState<CommunityTooltipData | null>(null);

  // Stable ref for callback
  const onCommunityClickRef = React.useRef(onCommunityClick);
  onCommunityClickRef.current = onCommunityClick;

  /* ────────────────────────────
     Render scheduler

     On-demand frame scheduling — each animation source
     calls scheduleFrame() when it needs a draw. All sources
     share draw(). Sources: d3 simulation ticks, zoom transitions,
     pointer interactions, resize, image load.
  ──────────────────────────── */

  const schedulerRef = React.useRef({
    raf: null as number | null,
    running: true,
  });

  const drawRef = React.useRef<(() => void) | null>(null);

  const scheduleFrame = React.useCallback(() => {
    const sched = schedulerRef.current;
    if (!sched.running || sched.raf) return;
    sched.raf = requestAnimationFrame(() => {
      sched.raf = null;
      drawRef.current?.();
    });
  }, []);

  /* ────────────────────────────
     Initialize universe simulation
  ──────────────────────────── */

  const initUniverse = React.useCallback(() => {
    const s = stateRef.current;
    const { width, height } = s;
    if (width === 0 || height === 0 || communities.length === 0) return;

    const newIds = communities.map((c) => c.id).join(",");
    if (newIds === s.lastCommunityIds && s.nodes.length > 0) return;
    s.lastCommunityIds = newIds;

    const maxMembers = Math.max(1, ...communities.map((c) => c.memberCount));
    const centerX = width / 2;
    const centerY = height / 2;

    const newNodes: UniverseNode[] = communities.map((c, i) => {
      const dominantLevel = c.orbitStats?.dominantLevel ?? "explorers";
      const color = ORBIT_LEVELS_COLORS[dominantLevel] ?? ORBIT_LEVELS_COLORS.explorers;
      const radius = computeUniverseRadius(c.memberCount, maxMembers);
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
        orbitStats: {
          advocates: c.orbitStats?.advocates ?? 0,
          contributors: c.orbitStats?.contributors ?? 0,
          participants: c.orbitStats?.participants ?? 0,
          explorers: c.orbitStats?.explorers ?? 0,
        },
        x: centerX + Math.cos(angle) * spread,
        y: centerY + Math.sin(angle) * spread,
      };
    });

    s.nodes = newNodes;

    // Load images
    for (const node of newNodes) {
      if (node.avatarUrl) s.imageCache.get(node.avatarUrl);
    }

    // Create links
    const nodeIds = new Set(newNodes.map((n) => n.id));
    const newLinks: UniverseLink[] = links
      .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
      .map((l) => ({
        source: l.source as unknown as UniverseNode,
        target: l.target as unknown as UniverseNode,
        sharedMembers: l.sharedMembers,
      }));
    s.links = newLinks;
    s.linkDirections = newLinks.map(() => Math.random() > 0.5);
    // Initialize connection midpoints at geometric midpoint with zero velocity
    s.connectionMidpoints = newLinks.map((l) => {
      const src = newNodes.find((n) => n.id === (l.source as unknown as string));
      const tgt = newNodes.find((n) => n.id === (l.target as unknown as string));
      const sx = src?.x ?? centerX;
      const sy = src?.y ?? centerY;
      const tx = tgt?.x ?? centerX;
      const ty = tgt?.y ?? centerY;
      return { x: (sx + tx) / 2, y: (sy + ty) / 2, vx: 0, vy: 0 };
    });
    s.lastPhysicsTime = performance.now();

    s.simulation?.stop();

    const sim = forceSimulation<UniverseNode>(newNodes)
      .force(
        "link",
        forceLink<UniverseNode, UniverseLink>(newLinks)
          .id((d) => d.id)
          .distance(200)
          .strength(0.08),
      )
      .force("charge", forceManyBody().strength(-500))
      .force("x", forceX(width / 2).strength(0.04))
      .force("y", forceY(height / 2).strength(0.04))
      .force(
        "collide",
        forceCollide<UniverseNode>()
          .radius((d) => d.radius + 12)
          .strength(1),
      )
      .velocityDecay(0.3)
      .on("tick", () => {
        scheduleFrame();
      });

    s.simulation = sim;

    if (!s.initialized) {
      s.initialized = true;
      s.startTime = performance.now();
      s.fadeIn = 0;
    }
  }, [communities, links, scheduleFrame]);

  React.useEffect(() => {
    initUniverse();
  }, [initUniverse]);

  /* ────────────────────────────
     Canvas setup + resize
  ──────────────────────────── */

  React.useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const s = stateRef.current;

    const handleResize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const isFirst = s.width === 0 && s.height === 0;

      s.width = w;
      s.height = h;
      s.dpr = dpr;

      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (isFirst) {
        initUniverse();
      } else if (s.simulation && s.mode === "idle") {
        s.simulation.force("x", forceX(w / 2).strength(0.04));
        s.simulation.force("y", forceY(h / 2).strength(0.04));
      }
      scheduleFrame();
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    handleResize();
    return () => ro.disconnect();
  }, [initUniverse, scheduleFrame]);

  /* ────────────────────────────
     Community click → zoom in → navigate
  ──────────────────────────── */

  const transitionRafRef = React.useRef<number | null>(null);

  const handleCommunityClick = React.useCallback(
    (community: OrbitCommunity, node: UniverseNode) => {
      const s = stateRef.current;
      if (s.mode !== "idle") return;

      // Pin clicked node
      const nodeWorldX = node.x ?? s.width / 2;
      const nodeWorldY = node.y ?? s.height / 2;
      node.fx = nodeWorldX;
      node.fy = nodeWorldY;

      // Stop simulation during zoom
      s.simulation?.stop();

      // Calculate target transform: zoom so clicked bubble fills center
      const targetScale = Math.min(s.width, s.height) / (node.radius * 4);
      const clampedScale = Math.min(10, Math.max(1, targetScale));

      s.transition = {
        startTime: performance.now(),
        transformFrom: { ...s.transform },
        transformTo: {
          x: s.width / 2 - nodeWorldX * clampedScale,
          y: s.height / 2 - nodeWorldY * clampedScale,
          k: clampedScale,
        },
        targetNode: node,
        targetHandle: community.handle,
      };

      s.mode = "zoom-in";
      s.fetchDone = false;
      sounds.play("whoosh", { volume: 0.075 });

      // Fire fetch now — it runs during the zoom animation.
      // Store result on window so the orbit page can grab it without re-fetching.
      apiGet("/api/community/get", { handle: community.handle }).then((result) => {
        if (result.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__orbitPrefetch = {
            handle: community.handle,
            data: result.value,
          };
          // Signal the orbit page to play the drum entrance sound (consumed once on mount)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (window as any).__orbitPlayDrum = true;
        }
        s.fetchDone = true;
        // If zoom already finished and we're waiting, navigate now
        if (s.mode === "waiting") {
          onCommunityClickRef.current?.(s.transition.targetHandle);
        }
      });

      // Clear tooltip
      s.hoveredNode = null;
      setCommunityTooltip(null);

      // Start zoom transition loop
      if (transitionRafRef.current) {
        cancelAnimationFrame(transitionRafRef.current);
        transitionRafRef.current = null;
      }

      const sched = schedulerRef.current;

      const tick = (now: number) => {
        if (!sched.running) return;
        transitionRafRef.current = null;

        const elapsed = now - s.transition.startTime;
        const rawT = Math.min(1, elapsed / UNIVERSE.ZOOM_DURATION);
        const t = easeInOutCubic(rawT);

        // Interpolate transform
        s.transform = {
          x: lerp(s.transition.transformFrom.x, s.transition.transformTo.x, t),
          y: lerp(s.transition.transformFrom.y, s.transition.transformTo.y, t),
          k: lerp(s.transition.transformFrom.k, s.transition.transformTo.k, t),
        };

        // Draw
        drawRef.current?.();

        if (rawT >= 1) {
          if (s.fetchDone) {
            // Both zoom and fetch done — navigate immediately
            onCommunityClickRef.current?.(s.transition.targetHandle);
          } else {
            // Zoom done, waiting for fetch — keep pulsing
            s.mode = "waiting";
            const pulse = () => {
              if (s.mode !== "waiting") return;
              drawRef.current?.();
              transitionRafRef.current = requestAnimationFrame(pulse);
            };
            transitionRafRef.current = requestAnimationFrame(pulse);
          }
          return;
        }

        transitionRafRef.current = requestAnimationFrame(tick);
      };

      transitionRafRef.current = requestAnimationFrame(tick);
    },
    [],
  );

  /* ────────────────────────────
     Render effect
  ──────────────────────────── */

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = stateRef.current;
    const sched = schedulerRef.current;
    sched.running = true;

    // Schedule frame when images load (ensures avatars appear even after simulation cools)
    s.imageCache.onLoad = () => scheduleFrame();

    const draw = () => {
      const { width: w, height: h, mode } = s;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      const { transform: t } = s;
      const now = performance.now();
      const elapsed = now - s.startTime;

      const bubbleFadeDuration = 600;
      const bridgeFadeDelay = bubbleFadeDuration + 200;
      const bridgeFadeDuration = 800;

      if (s.initialized && s.fadeIn < 1) {
        s.fadeIn = Math.min(1, elapsed / bubbleFadeDuration);
      }

      const bridgeProgress = s.initialized
        ? Math.max(0, Math.min(1, (elapsed - bridgeFadeDelay) / bridgeFadeDuration))
        : 0;
      const easedBridge = easeOutCubic(bridgeProgress);
      const bubbleOpacity = s.fadeIn;

      if (!s.initialized || bubbleOpacity === 0) return;

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // ── Connection midpoint physics ──
      {
        const dt = Math.min(
          CONNECTION_PHYSICS.MAX_DT,
          s.lastPhysicsTime > 0 ? (now - s.lastPhysicsTime) / 1000 : 0.016,
        );
        s.lastPhysicsTime = now;

        for (let i = 0; i < s.links.length; i++) {
          const link = s.links[i];
          const mid = s.connectionMidpoints[i];
          if (!mid) continue;

          const src = link.source as UniverseNode;
          const tgt = link.target as UniverseNode;
          if (
            src.x === undefined || src.y === undefined ||
            tgt.x === undefined || tgt.y === undefined
          ) continue;

          // Spring pulls midpoint toward the geometric center of both endpoints
          const centerX = (src.x + tgt.x) / 2;
          const centerY = (src.y + tgt.y) / 2;
          const dxC = centerX - mid.x;
          const dyC = centerY - mid.y;

          let fx = dxC * CONNECTION_PHYSICS.SPRING_K;
          let fy = dyC * CONNECTION_PHYSICS.SPRING_K;

          // Gravity (always pulls downward)
          fy += CONNECTION_PHYSICS.GRAVITY;

          // Perpendicular side bias so alternating links curve to different sides
          const abDx = tgt.x - src.x;
          const abDy = tgt.y - src.y;
          const abLen = Math.sqrt(abDx * abDx + abDy * abDy);
          if (abLen > 0) {
            const perpX = -abDy / abLen;
            const perpY = abDx / abLen;
            const sign = i % 2 === 0 ? 1 : -1;
            fx += perpX * CONNECTION_PHYSICS.SIDE_BIAS * sign;
            fy += perpY * CONNECTION_PHYSICS.SIDE_BIAS * sign;
          }

          // Euler integration
          mid.vx += fx * dt;
          mid.vy += fy * dt;

          // Damping
          const damp = Math.exp(-CONNECTION_PHYSICS.DAMPING * dt);
          mid.vx *= damp;
          mid.vy *= damp;

          mid.x += mid.vx * dt;
          mid.y += mid.vy * dt;
        }
      }

      // ── Links with flowing energy (hidden during zoom-in / waiting) ──
      if (bridgeProgress > 0 && mode !== "zoom-in" && mode !== "waiting") {
        ctx.globalAlpha = easedBridge;
        const baseWidth = ENERGY_FLOW.BASE_WIDTH / t.k;
        const fallbackRgb = ENERGY_FLOW.GLOW_RGB;

        for (let i = 0; i < s.links.length; i++) {
          const link = s.links[i];
          const src = link.source as UniverseNode;
          const tgt = link.target as UniverseNode;
          if (
            src.x === undefined ||
            src.y === undefined ||
            tgt.x === undefined ||
            tgt.y === undefined
          )
            continue;

          // Per-link color: average orbit stats of both communities → dominant level → color
          const avgStats = {
            advocates: src.orbitStats.advocates + tgt.orbitStats.advocates,
            contributors: src.orbitStats.contributors + tgt.orbitStats.contributors,
            participants: src.orbitStats.participants + tgt.orbitStats.participants,
            explorers: src.orbitStats.explorers + tgt.orbitStats.explorers,
          };
          const linkLevel = dominantOrbitLevel(avgStats);
          const linkHex = ORBIT_LEVELS_COLORS[linkLevel];
          const [gr, gg, gb] = linkHex ? hexToRgb(linkHex) : fallbackRgb;

          const reversed = s.linkDirections[i] ?? false;
          const sx = reversed ? tgt.x : src.x;
          const sy = reversed ? tgt.y : src.y;
          const ex = reversed ? src.x : tgt.x;
          const ey = reversed ? src.y : tgt.y;

          // Use physics-simulated midpoint as Bezier control point
          const mid = s.connectionMidpoints[i];
          const cpx = mid ? mid.x : (sx + ex) / 2;
          const cpy = mid ? mid.y : (sy + ey) / 2;

          // Slack for wave amplitude modulation
          const fullDx = ex - sx;
          const fullDy = ey - sy;
          const fullLen = Math.sqrt(fullDx * fullDx + fullDy * fullDy);
          const slack = Math.max(0, 200 - fullLen);

          // Bezier helpers
          // Position: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
          const bezX = (bt: number) =>
            (1 - bt) * (1 - bt) * sx + 2 * (1 - bt) * bt * cpx + bt * bt * ex;
          const bezY = (bt: number) =>
            (1 - bt) * (1 - bt) * sy + 2 * (1 - bt) * bt * cpy + bt * bt * ey;
          // Tangent: B'(t) = 2(1-t)(P1-P0) + 2t(P2-P1)
          const bezTx = (bt: number) =>
            2 * (1 - bt) * (cpx - sx) + 2 * bt * (ex - cpx);
          const bezTy = (bt: number) =>
            2 * (1 - bt) * (cpy - sy) + 2 * bt * (ey - cpy);

          // Pre-sample the curve with sine-wave displacement
          const samples = Math.max(4, Math.ceil(fullLen / ENERGY_FLOW.PX_PER_SAMPLE));
          const wavePhase = now * ENERGY_FLOW.WAVE_SPEED;
          const slackRatio = Math.min(2, slack / 50);
          const waveAmp = ENERGY_FLOW.WAVE_AMPLITUDE * (0.5 + slackRatio);
          const pts: { x: number; y: number }[] = [];

          for (let si = 0; si <= samples; si++) {
            const bt = si / samples;
            const bx = bezX(bt);
            const by = bezY(bt);

            // Perpendicular to tangent at this point
            const tx = bezTx(bt);
            const ty = bezTy(bt);
            const tLen = Math.sqrt(tx * tx + ty * ty);

            if (tLen > 0 && si > 0 && si < samples) {
              const nx = -ty / tLen;
              const ny = tx / tLen;
              const arcFrac = (si / samples) * fullLen;
              const taper = Math.sin((si / samples) * Math.PI);
              const wave =
                Math.sin(arcFrac * ENERGY_FLOW.WAVE_FREQUENCY * (Math.PI * 2 / 100) + wavePhase) *
                waveAmp *
                taper;
              pts.push({ x: bx + nx * wave, y: by + ny * wave });
            } else {
              pts.push({ x: bx, y: by });
            }
          }

          // Base wavy line
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          for (let si = 1; si < pts.length; si++) {
            ctx.lineTo(pts[si].x, pts[si].y);
          }
          ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
          ctx.lineWidth = baseWidth;
          ctx.lineCap = "round";
          ctx.lineJoin = "round";
          ctx.stroke();

          // Cumulative arc-length distances
          const cumDist: number[] = [0];
          for (let si = 1; si < pts.length; si++) {
            const dx2 = pts[si].x - pts[si - 1].x;
            const dy2 = pts[si].y - pts[si - 1].y;
            cumDist.push(cumDist[si - 1] + Math.sqrt(dx2 * dx2 + dy2 * dy2));
          }
          const totalLen = cumDist[cumDist.length - 1];

          // Energy flow overlay along the curve
          if (totalLen > 10) {
            const flowPos = (now * ENERGY_FLOW.SPEED) % ENERGY_FLOW.PULSE_SPACING;

            for (let si = 0; si < pts.length - 1; si++) {
              const segMid = (cumDist[si] + cumDist[si + 1]) / 2;

              let brightness = 0;
              for (
                let offset = -ENERGY_FLOW.PULSE_SPACING;
                offset <= totalLen + ENERGY_FLOW.PULSE_SPACING;
                offset += ENERGY_FLOW.PULSE_SPACING
              ) {
                const dist = Math.abs(segMid - (flowPos + offset));
                if (dist < ENERGY_FLOW.PULSE_WIDTH) {
                  const intensity =
                    (Math.cos((dist / ENERGY_FLOW.PULSE_WIDTH) * Math.PI) + 1) / 2;
                  brightness = Math.max(brightness, intensity);
                }
              }

              const b = Math.max(0.08, brightness);

              ctx.beginPath();
              ctx.moveTo(pts[si].x, pts[si].y);
              ctx.lineTo(pts[si + 1].x, pts[si + 1].y);
              ctx.strokeStyle = `rgba(${gr}, ${gg}, ${gb}, ${b * ENERGY_FLOW.GLOW_OPACITY})`;
              ctx.lineWidth = baseWidth + b * (ENERGY_FLOW.GLOW_WIDTH_BOOST / t.k);
              ctx.lineCap = "round";
              ctx.stroke();
            }
          }
        }
      }

      // ── Nodes ──
      ctx.globalAlpha = bubbleOpacity;

      for (const n of s.nodes) {
        if (n.x === undefined || n.y === undefined) continue;

        const isHovered = s.hoveredNode?.id === n.id;
        const radius = n.radius;

        // During zoom-in, fade out non-target nodes
        if ((mode === "zoom-in" || mode === "waiting") && s.transition.targetNode) {
          const isTarget = n.id === s.transition.targetNode.id;
          if (!isTarget) {
            if (mode === "waiting") {
              continue;
            } else {
              const zoomElapsed = now - s.transition.startTime;
              const fadeT = Math.min(1, zoomElapsed / (UNIVERSE.ZOOM_DURATION * 0.5));
              ctx.globalAlpha = bubbleOpacity * (1 - fadeT);
            }
          } else {
            // Pulse the target bubble while waiting for fetch
            if (mode === "waiting") {
              ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 200);
            } else {
              ctx.globalAlpha = bubbleOpacity;
            }
          }
        }

        // Background fill
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();

        // Avatar image
        const img = s.imageCache.get(n.avatarUrl);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, n.x - radius, n.y - radius, radius * 2, radius * 2);
          ctx.restore();
        }

        // Border — brighter on hover
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered
          ? "rgba(255, 255, 255, 1)"
          : "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = (isHovered ? 3 : 1.5) / t.k;
        ctx.stroke();

        // Reset alpha for next node
        ctx.globalAlpha = bubbleOpacity;
      }

      ctx.restore();

      // ── Highlight anchor — position a DOM element over a specific node ──
      const anchorEl = highlightAnchorRef.current;
      const anchorHandle = highlightHandleRef.current;
      if (anchorEl && anchorHandle) {
        const node = s.nodes.find((n) => n.handle === anchorHandle);
        if (node && node.x !== undefined && node.y !== undefined) {
          const screenR = node.radius * t.k;
          const cx = node.x * t.k + t.x;
          const cy = node.y * t.k + t.y;
          anchorEl.style.left = `${cx - screenR}px`;
          anchorEl.style.top = `${cy - screenR}px`;
          anchorEl.style.width = `${screenR * 2}px`;
          anchorEl.style.height = `${screenR * 2}px`;
          anchorEl.style.display = "block";
        } else {
          anchorEl.style.display = "none";
        }
      }

      // Keep scheduling: during intro animations, and continuously
      // once links are visible (energy flow needs ongoing frames)
      if (s.fadeIn < 1 || bridgeProgress < 1) {
        scheduleFrame();
      } else if (mode === "idle" && s.links.length > 0) {
        // Continuous rAF for energy flow animation
        scheduleFrame();
      }
    };

    drawRef.current = draw;
    draw();

    return () => {
      sched.running = false;
      if (sched.raf) {
        cancelAnimationFrame(sched.raf);
        sched.raf = null;
      }
      if (transitionRafRef.current) {
        cancelAnimationFrame(transitionRafRef.current);
        transitionRafRef.current = null;
      }
      drawRef.current = null;
      s.imageCache.onLoad = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- effect only uses refs; must run exactly once
  }, []);

  /* ────────────────────────────
     Pointer / touch events

     Android Chrome can suppress pointerup AND click for quick taps on
     canvas elements with touch-action:none. The only touch event that
     fires reliably is `touchend`. We store the tapped node from
     pointerdown and fire the action from touchend (touch) or click (mouse).
  ──────────────────────────── */

  /** Prevents click from double-firing after touchend already handled it */
  const tapHandledRef = React.useRef(false);

  const onPointerMove = React.useCallback(
    (e: React.PointerEvent) => {
      const s = stateRef.current;
      if (s.mode !== "idle") return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (s.draggedNode) {
        // Ignore jitter — only start actual drag after 8px movement
        if (!s.wasDrag && s.pointerStartScreen) {
          const jx = e.clientX - s.pointerStartScreen.x;
          const jy = e.clientY - s.pointerStartScreen.y;
          if (jx * jx + jy * jy < 64) return;
          s.wasDrag = true;
          s.pendingTapNodeId = null; // cancel tap
          try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* ignore */ }
        }
        const t = s.transform;
        s.draggedNode.fx = (x - t.x) / t.k;
        s.draggedNode.fy = (y - t.y) / t.k;
        scheduleFrame();
        return;
      }

      // Hover detection
      const t = s.transform;
      const wx = (x - t.x) / t.k;
      const wy = (y - t.y) / t.k;

      let picked: UniverseNode | null = null;
      for (let i = s.nodes.length - 1; i >= 0; i--) {
        const n = s.nodes[i];
        if (n.x === undefined || n.y === undefined) continue;
        const dx = n.x - wx;
        const dy = n.y - wy;
        if (dx * dx + dy * dy <= n.radius * n.radius) {
          picked = n;
          break;
        }
      }

      if (picked !== s.hoveredNode) {
        s.hoveredNode = picked;
        if (picked && picked.x !== undefined && picked.y !== undefined) {
          sounds.play("hover");
          const screenX = picked.x * t.k + t.x + rect.left;
          const screenY = picked.y * t.k + t.y + rect.top;
          const screenRadius = picked.radius * t.k + 1.5;
          setCommunityTooltip({
            name: picked.name,
            memberCount: picked.memberCount,
            isPublic: picked.isPublic,
            isMembershipOpen: picked.isMembershipOpen,
            x: screenX,
            y: screenY,
            screenRadius,
          });
        } else {
          setCommunityTooltip(null);
        }
        scheduleFrame();
      }
    },
    [scheduleFrame],
  );

  const onPointerDown = React.useCallback(
    (e: React.PointerEvent) => {
      const s = stateRef.current;
      if (s.mode !== "idle") return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      s.wasDrag = false;
      s.pointerStartScreen = { x: e.clientX, y: e.clientY };
      s.pendingTapNodeId = null;
      tapHandledRef.current = false;

      const t = s.transform;
      const wx = (x - t.x) / t.k;
      const wy = (y - t.y) / t.k;

      const isTouch = e.pointerType === "touch";
      const hitMultiplier = isTouch ? 1.4 : 1;

      for (let i = s.nodes.length - 1; i >= 0; i--) {
        const n = s.nodes[i];
        if (n.x === undefined || n.y === undefined) continue;
        const dx = n.x - wx;
        const dy = n.y - wy;
        const hitRadius = n.radius * hitMultiplier;
        if (dx * dx + dy * dy <= hitRadius * hitRadius) {
          s.draggedNode = n;
          s.dragStart = { x: n.x, y: n.y };
          s.pendingTapNodeId = n.id;
          n.fx = n.x;
          n.fy = n.y;

          s.hoveredNode = null;
          setCommunityTooltip(null);
          s.simulation?.alphaTarget(0.3).restart();
          scheduleFrame();
          return;
        }
      }
    },
    [scheduleFrame],
  );

  /** Clean up drag state — shared by pointerup and pointercancel. */
  const finishPointer = React.useCallback(
    (e: React.PointerEvent) => {
      const s = stateRef.current;

      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }

      const draggedNode = s.draggedNode;
      if (draggedNode) {
        s.simulation?.alphaTarget(0);
        s.draggedNode = null;
        s.dragStart = null;
        draggedNode.fx = null;
        draggedNode.fy = null;
        scheduleFrame();
      }
    },
    [scheduleFrame],
  );

  const onPointerUp = finishPointer;
  const onPointerCancel = finishPointer;

  /** Fire the stored tap — uses node ID from pointerdown so it works even
   *  if the node has moved back to its orbit position. */
  const fireTap = React.useCallback(() => {
    const s = stateRef.current;
    if (s.mode !== "idle") return;

    const nodeId = s.pendingTapNodeId;
    s.pendingTapNodeId = null;
    if (!nodeId) return;

    // Clean up any lingering drag state
    const draggedNode = s.draggedNode;
    if (draggedNode) {
      s.simulation?.alphaTarget(0);
      s.draggedNode = null;
      s.dragStart = null;
      draggedNode.fx = null;
      draggedNode.fy = null;
    }

    const node = s.nodes.find((n) => n.id === nodeId);
    const community = communities.find((c) => c.id === nodeId);
    if (node && community) {
      handleCommunityClick(community, node);
    }
  }, [communities, handleCommunityClick]);

  /** touchend — the only event guaranteed to fire on Android for quick taps. */
  const onTouchEnd = React.useCallback(
    (e: React.TouchEvent) => {
      const s = stateRef.current;
      if (!s.pendingTapNodeId || s.wasDrag) return;

      e.preventDefault(); // prevent synthetic click from double-firing
      tapHandledRef.current = true;
      fireTap();
    },
    [fireTap],
  );

  /** click — fires reliably for mouse; fallback for touch if touchend missed */
  const onClick = React.useCallback(
    (e: React.MouseEvent) => {
      void e; // coordinates not needed — we use stored node ID
      if (tapHandledRef.current) {
        tapHandledRef.current = false;
        return;
      }
      fireTap();
    },
    [fireTap],
  );

  const onPointerLeave = React.useCallback(() => {
    const s = stateRef.current;
    if (s.hoveredNode) {
      s.hoveredNode = null;
      setCommunityTooltip(null);
      scheduleFrame();
    }
  }, [scheduleFrame]);

  const onWheel = React.useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();

      const s = stateRef.current;
      if (s.mode !== "idle") return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const t = s.transform;
      const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;

      const newK = Math.max(0.1, Math.min(10, t.k * scaleFactor));

      const wx = (x - t.x) / t.k;
      const wy = (y - t.y) / t.k;

      s.transform = {
        k: newK,
        x: x - wx * newK,
        y: y - wy * newK,
      };
      scheduleFrame();
    },
    [scheduleFrame],
  );

  /* ────────────────────────────
     Cursor
  ──────────────────────────── */

  const cursor = communityTooltip ? "pointer" : "default";

  /* ────────────────────────────
     Render
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
        onPointerCancel={onPointerCancel}
        onPointerLeave={onPointerLeave}
        onTouchEnd={onTouchEnd}
        onClick={onClick}
        onWheel={onWheel}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          touchAction: "none",
          cursor,
        }}
        aria-label="Community universe"
        role="img"
      />

      {/* Invisible DOM anchor positioned over a highlighted community node (for guided tours) */}
      {highlightHandle && (
        <div
          ref={highlightAnchorRef}
          data-tour={`community-${highlightHandle}`}
          style={{
            position: "absolute",
            display: "none",
            borderRadius: "9999px",
            pointerEvents: "none",
          }}
        />
      )}

      {communityTooltip && stateRef.current.mode === "idle" && (
        <NodeTooltip
          x={communityTooltip.x}
          y={communityTooltip.y}
          screenRadius={communityTooltip.screenRadius}
          className="min-w-[180px] max-w-[280px]"
        >
          <CommunityTooltipContent
            name={communityTooltip.name}
            memberCount={communityTooltip.memberCount}
            isPublic={communityTooltip.isPublic}
            isMembershipOpen={communityTooltip.isMembershipOpen}
          />
        </NodeTooltip>
      )}
    </div>
  );
}
