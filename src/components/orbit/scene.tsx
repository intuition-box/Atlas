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

import { UsersIcon, UserIcon, CheckIcon, PlusIcon, ArrowLeftIcon } from "@/components/ui/icons";
import { apiGet } from "@/lib/api/client";
import { NodeTooltip, NodePopover } from "./node-popover";
import {
  RING_RADII,
  PERSPECTIVE_RATIO,
  SIMULATION,
  LEVEL_COLORS,
  NODE_RADIUS,
  ORBIT_ROTATION,
  INTERACTION,
} from "./constants";
import {
  EllipseArcTable,
  distributeEvenlyOnEllipse,
} from "./ellipse-arc-distribution";
import type {
  OrbitMember,
  MemberLink,
  SimulatedNode,
  OrbitLevel,
} from "./types";

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

type SceneMode = "universe" | "zoom-in" | "loading" | "orbit" | "zoom-out";

interface UniverseNode extends SimulationNodeDatum {
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

interface UniverseLink extends SimulationLinkDatum<UniverseNode> {
  sharedMembers: number;
}

type UniverseTooltipData = {
  name: string;
  handle: string;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  x: number;
  y: number;
};

type Transform = { x: number; y: number; k: number };

type CommunityGetResponse = {
  mode: "full" | "splash";
  community: {
    id: string;
    handle: string | null;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    isMembershipOpen: boolean;
    isPublicDirectory: boolean;
    membershipConfig: unknown | null;
    orbitConfig: unknown | null;
  };
  canViewDirectory: boolean;
  isAdmin: boolean;
  viewerMembership: {
    status: string;
    role: string;
  } | null;
  orbitMembers: unknown[];
  memberLinks?: unknown[];
};

/* ────────────────────────────
   Props
──────────────────────────── */

interface OrbitSceneProps {
  communities: OrbitCommunity[];
  links?: OrbitLink[];
  onMemberClick?: (memberId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

/* ────────────────────────────
   Constants
──────────────────────────── */

const UNIVERSE_MIN_RADIUS = 14;
const UNIVERSE_MAX_RADIUS = 44;
const CENTER_LOGO_RADIUS = 32;
const ZOOM_DURATION = 800; // ms
const FADE_OVERLAP = 300; // ms — fade starts this many ms before zoom ends

const ORBIT_COLORS: Record<string, string> = {
  advocates: "#3b82f6",
  contributors: "#60a5fa",
  participants: "#ffffff",
  explorers: "#9ca3af",
};

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

function computeUniverseRadius(memberCount: number, maxMembers: number): number {
  if (maxMembers <= 0 || memberCount <= 0) return UNIVERSE_MIN_RADIUS;
  const t = Math.sqrt(memberCount / maxMembers);
  return UNIVERSE_MIN_RADIUS + t * (UNIVERSE_MAX_RADIUS - UNIVERSE_MIN_RADIUS);
}

function computeOrbitNodeRadius(reachScore: number): number {
  const t = Math.min(1, reachScore / 100);
  return NODE_RADIUS.MIN + t * (NODE_RADIUS.MAX - NODE_RADIUS.MIN);
}

/** Lazily loads images and caches them by URL */
class ImageCache {
  private cache = new Map<string, HTMLImageElement | null>();
  private loading = new Set<string>();

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
    };
    img.onerror = () => {
      this.loading.delete(url);
      this.cache.set(url, null);
    };
    return undefined;
  }
}

/* ────────────────────────────
   Orbit simulation helpers
   (imperative version of useOrbitSimulation)
──────────────────────────── */

const arcTableCache = new Map<number, EllipseArcTable>();

function getArcTable(rx: number): EllipseArcTable {
  let table = arcTableCache.get(rx);
  if (!table) {
    table = new EllipseArcTable(rx, rx * PERSPECTIVE_RATIO);
    arcTableCache.set(rx, table);
  }
  return table;
}

function createOrbitNodes(members: OrbitMember[]): SimulatedNode[] {
  const byLevel = new Map<OrbitLevel, OrbitMember[]>();
  for (const m of members) {
    const group = byLevel.get(m.orbitLevel) ?? [];
    group.push(m);
    byLevel.set(m.orbitLevel, group);
  }

  const nodes: SimulatedNode[] = [];
  for (const [level, levelMembers] of byLevel) {
    const color = LEVEL_COLORS[level];
    const tValues = distributeEvenlyOnEllipse(levelMembers.length);
    for (let i = 0; i < levelMembers.length; i++) {
      const m = levelMembers[i];
      nodes.push({
        id: m.id,
        handle: m.handle ?? null,
        name: m.name,
        avatarUrl: m.avatarUrl ?? null,
        headline: m.headline ?? null,
        location: m.location ?? null,
        tags: m.tags ?? [],
        orbitLevel: m.orbitLevel,
        loveScore: m.loveScore,
        reachScore: m.reachScore,
        lastActiveAt: m.lastActiveAt ?? null,
        radius: computeOrbitNodeRadius(m.reachScore),
        color,
        baseT: tValues[i],
      });
    }
  }
  return nodes;
}

function forceOrbitTargets(
  cx: number,
  cy: number,
  ringRotation: Record<string, number>,
  strength: number,
) {
  let nodes: SimulatedNode[] = [];

  function force() {
    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;
      const rx = RING_RADII[node.orbitLevel];
      const ry = rx * PERSPECTIVE_RATIO;
      const table = getArcTable(rx);
      const effectiveT = node.baseT + (ringRotation[node.orbitLevel] ?? 0);
      const angle = table.tToAngle(effectiveT);
      const targetX = cx + Math.cos(angle) * rx;
      const targetY = cy + Math.sin(angle) * ry;
      node.vx = 0;
      node.vy = 0;
      node.vx = (targetX - (node.x ?? cx)) * strength;
      node.vy = (targetY - (node.y ?? cy)) * strength;
    }
  }

  force.initialize = (n: SimulatedNode[]) => {
    nodes = n;
  };

  return force;
}

function parseMembers(raw: unknown[]): OrbitMember[] {
  const result: OrbitMember[] = [];
  for (const m of raw as any[]) {
    const id = String(m?.id ?? "");
    const name = String(m?.name ?? "");
    const handle = (m?.handle ?? null) as string | null;
    const orbitLevel = m?.orbitLevel as OrbitMember["orbitLevel"];
    const validLevels = ["ADVOCATE", "CONTRIBUTOR", "PARTICIPANT", "EXPLORER"];
    if (!validLevels.includes(orbitLevel)) continue;
    if (!id || !name) continue;
    result.push({
      id,
      handle,
      name,
      avatarUrl: (m?.avatarUrl ?? m?.image ?? null) as string | null,
      orbitLevel,
      loveScore: Number(m?.loveScore ?? 0),
      reachScore: Number(m?.reachScore ?? 0),
      headline: (m?.headline ?? null) as string | null,
      location: (m?.location ?? null) as string | null,
      tags: Array.isArray(m?.tags) ? m.tags : [],
      lastActiveAt: (m?.lastActiveAt ?? null) as string | null,
    });
  }
  return result;
}

function parseMemberLinks(raw: unknown[] | undefined): MemberLink[] {
  if (!raw || !Array.isArray(raw)) return [];
  const result: MemberLink[] = [];
  for (const l of raw as any[]) {
    const source = String(l?.source ?? "");
    const target = String(l?.target ?? "");
    const weight = Number(l?.weight ?? 1);
    if (!source || !target) continue;
    result.push({ source, target, weight });
  }
  return result;
}

/* ────────────────────────────
   Universe Tooltip
──────────────────────────── */

function UniverseTooltip({ data }: { data: UniverseTooltipData }) {
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

export function OrbitScene({
  communities,
  links = [],
  onMemberClick,
  className,
  style,
}: OrbitSceneProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const stateRef = React.useRef({
    // Canvas dimensions
    width: 0,
    height: 0,
    dpr: 1,

    // Scene mode
    mode: "universe" as SceneMode,

    // Transform (shared between modes)
    transform: { x: 0, y: 0, k: 1 } as Transform,

    // Transition state
    transition: {
      startTime: 0,
      transformFrom: { x: 0, y: 0, k: 1 } as Transform,
      transformTo: { x: 0, y: 0, k: 1 } as Transform,
      targetCommunity: null as OrbitCommunity | null,
      targetNode: null as UniverseNode | null,
    },

    // Universe state
    universe: {
      simulation: null as Simulation<UniverseNode, UniverseLink> | null,
      nodes: [] as UniverseNode[],
      links: [] as UniverseLink[],
      initialized: false,
      startTime: 0,
      fadeIn: 0,
      linkDirections: [] as boolean[],
      lastCommunityIds: "",
    },

    // Orbit state
    orbit: {
      simulation: null as Simulation<SimulatedNode, never> | null,
      nodes: [] as SimulatedNode[],
      ringRotation: {} as Record<string, number>,
      centerLogoUrl: null as string | null,
      centerName: "",
      members: [] as OrbitMember[],
      paused: false,
      fadeIn: 0,
      startTime: 0,
    },

    // Image cache (shared)
    imageCache: new ImageCache(),

    // Pointer state
    pointer: { x: 0, y: 0, inside: false },
    draggedNode: null as UniverseNode | null,
    dragStart: null as { x: number; y: number } | null,
    hoveredUniverseNode: null as UniverseNode | null,
    hoveredOrbitNodeId: null as string | null,

    // Orbit drag
    orbitDrag: null as {
      type: "node" | "pan";
      nodeId?: string;
      pointerId: number;
      didMove: boolean;
      startX?: number;
      startY?: number;
      startTx?: number;
      startTy?: number;
    } | null,

    // Saved universe transform (for zoom-out return)
    savedUniverseTransform: { x: 0, y: 0, k: 1 } as Transform,

    // rAF
    raf: null as number | null,

    // Data fetch state
    fetchAbort: null as AbortController | null,
    fetchedData: null as { members: OrbitMember[]; links: MemberLink[] } | null,
    fetchError: null as string | null,
  });

  // React state for tooltips/popovers (need re-renders)
  const [universeTooltip, setUniverseTooltip] = React.useState<UniverseTooltipData | null>(null);
  const [orbitTooltip, setOrbitTooltip] = React.useState<{
    node: SimulatedNode;
    x: number;
    y: number;
  } | null>(null);
  const [orbitPopover, setOrbitPopover] = React.useState<{
    node: SimulatedNode;
    x: number;
    y: number;
  } | null>(null);
  const [sceneMode, setSceneMode] = React.useState<SceneMode>("universe");

  // Stable refs
  const onMemberClickRef = React.useRef(onMemberClick);
  onMemberClickRef.current = onMemberClick;

  /* ────────────────────────────
     Initialize universe simulation
  ──────────────────────────── */

  const initUniverse = React.useCallback(() => {
    const s = stateRef.current;
    const { width, height } = s;
    if (width === 0 || height === 0 || communities.length === 0) return;

    const newIds = communities.map((c) => c.id).join(",");
    if (newIds === s.universe.lastCommunityIds && s.universe.nodes.length > 0) return;
    s.universe.lastCommunityIds = newIds;

    const maxMembers = Math.max(1, ...communities.map((c) => c.memberCount));
    const centerX = width / 2;
    const centerY = height / 2;

    const newNodes: UniverseNode[] = communities.map((c, i) => {
      const dominantLevel = c.orbitStats?.dominantLevel ?? "explorers";
      const color = ORBIT_COLORS[dominantLevel];
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
        x: centerX + Math.cos(angle) * spread,
        y: centerY + Math.sin(angle) * spread,
      };
    });

    s.universe.nodes = newNodes;

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
    s.universe.links = newLinks;
    s.universe.linkDirections = newLinks.map(() => Math.random() > 0.5);

    s.universe.simulation?.stop();

    const sim = forceSimulation<UniverseNode>(newNodes)
      .force("link", forceLink<UniverseNode, UniverseLink>(newLinks).id((d) => d.id).distance(120))
      .force("charge", forceManyBody().strength(-350))
      .force("x", forceX(width / 2).strength(0.04))
      .force("y", forceY(height / 2).strength(0.04))
      .force("collide", forceCollide<UniverseNode>().radius((d) => d.radius + 12).strength(1));

    s.universe.simulation = sim;

    if (!s.universe.initialized) {
      s.universe.initialized = true;
      s.universe.startTime = performance.now();
      s.universe.fadeIn = 0;
    }
  }, [communities, links]);

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
      } else if (s.universe.simulation && s.mode === "universe") {
        s.universe.simulation.force("x", forceX(w / 2).strength(0.04));
        s.universe.simulation.force("y", forceY(h / 2).strength(0.04));
      }
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    handleResize();
    return () => ro.disconnect();
  }, [initUniverse]);

  /* ────────────────────────────
     Start orbit simulation
  ──────────────────────────── */

  const startOrbitSimulation = React.useCallback((members: OrbitMember[], memberLinks: MemberLink[]) => {
    const s = stateRef.current;
    const cx = s.width / 2;
    const cy = s.height / 2;

    const nodes = createOrbitNodes(members);

    // Start all nodes at center for fly-in effect
    for (const n of nodes) {
      n.x = cx;
      n.y = cy;
    }

    s.orbit.nodes = nodes;
    s.orbit.members = members;
    s.orbit.ringRotation = {};
    s.orbit.paused = false;
    s.orbit.fadeIn = 0;
    s.orbit.startTime = performance.now();

    // Load avatars
    for (const n of nodes) {
      if (n.avatarUrl) s.imageCache.get(n.avatarUrl);
    }

    // Load center logo
    if (s.orbit.centerLogoUrl) s.imageCache.get(s.orbit.centerLogoUrl);

    s.orbit.simulation?.stop();

    const sim = forceSimulation<SimulatedNode>(nodes)
      .alphaDecay(0)
      .alpha(1)
      .velocityDecay(SIMULATION.VELOCITY_DECAY)
      .force(
        "orbit",
        forceOrbitTargets(cx, cy, s.orbit.ringRotation, SIMULATION.RADIAL_STRENGTH),
      )
      .force(
        "collision",
        forceCollide<SimulatedNode>()
          .radius((d) => d.radius + SIMULATION.COLLISION_PADDING)
          .strength(SIMULATION.COLLISION_STRENGTH)
          .iterations(SIMULATION.COLLISION_ITERATIONS),
      )
      .on("tick", () => {
        // d3 mutates positions in place — rAF reads them
      });

    s.orbit.simulation = sim;
  }, []);

  /* ────────────────────────────
     Community click → zoom in
  ──────────────────────────── */

  const handleCommunityClick = React.useCallback((community: OrbitCommunity, node: UniverseNode) => {
    const s = stateRef.current;
    if (s.mode !== "universe") return;

    // Save current universe transform for zoom-out return
    s.savedUniverseTransform = { ...s.transform };

    // Calculate target transform: zoom so the clicked bubble fills center
    const nodeWorldX = node.x ?? s.width / 2;
    const nodeWorldY = node.y ?? s.height / 2;
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
      targetCommunity: community,
      targetNode: node,
    };

    s.mode = "zoom-in";
    setSceneMode("zoom-in");

    // Clear tooltips
    s.hoveredUniverseNode = null;
    setUniverseTooltip(null);

    // Start fetching community data
    s.fetchAbort?.abort();
    const controller = new AbortController();
    s.fetchAbort = controller;
    s.fetchedData = null;
    s.fetchError = null;

    // Set orbit center info
    s.orbit.centerLogoUrl = community.avatarUrl ?? null;
    s.orbit.centerName = community.name;

    void (async () => {
      try {
        const result = await apiGet<CommunityGetResponse>(
          "/api/community/get",
          { handle: community.handle },
          { signal: controller.signal },
        );

        if (controller.signal.aborted) return;

        if (result.ok && result.value.canViewDirectory) {
          const members = parseMembers(result.value.orbitMembers ?? []);
          const memberLinks = parseMemberLinks(result.value.memberLinks);
          s.fetchedData = { members, links: memberLinks };

          // If zoom already finished, transition to orbit now
          if (s.mode === "loading") {
            startOrbitSimulation(members, memberLinks);
            s.mode = "orbit";
            setSceneMode("orbit");
            // Reset transform for orbit view
            s.transform = { x: s.width / 2, y: s.height / 2, k: 1 };
          }
        } else {
          s.fetchError = "Could not load community data";
        }
      } catch {
        if (!controller.signal.aborted) {
          s.fetchError = "Failed to load community";
        }
      }
    })();
  }, [startOrbitSimulation]);

  /* ────────────────────────────
     Back → zoom out
  ──────────────────────────── */

  const handleBack = React.useCallback(() => {
    const s = stateRef.current;
    if (s.mode !== "orbit" && s.mode !== "loading") return;

    // Stop orbit simulation
    s.orbit.simulation?.stop();
    s.orbit.simulation = null;
    s.orbit.nodes = [];

    // Clear orbit UI
    setOrbitTooltip(null);
    setOrbitPopover(null);

    // Setup zoom-out transition
    s.transition = {
      startTime: performance.now(),
      transformFrom: { ...s.transform },
      transformTo: { ...s.savedUniverseTransform },
      targetCommunity: s.transition.targetCommunity,
      targetNode: s.transition.targetNode,
    };

    s.mode = "zoom-out";
    setSceneMode("zoom-out");

    // Cancel any pending fetch
    s.fetchAbort?.abort();
    s.fetchAbort = null;
    s.fetchedData = null;
    s.fetchError = null;

    // Resume universe simulation
    if (s.universe.simulation) {
      s.universe.simulation.alphaTarget(0.1).restart();
      setTimeout(() => {
        s.universe.simulation?.alphaTarget(0);
      }, 500);
    }
  }, []);

  /* ────────────────────────────
     Animation loop
  ──────────────────────────── */

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = stateRef.current;
    let running = true;
    let lastOrbitTick = performance.now();

    const screenToWorld = (sx: number, sy: number): { x: number; y: number } => {
      const t = s.transform;
      return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k };
    };

    const pickUniverseNode = (sx: number, sy: number): UniverseNode | null => {
      const world = screenToWorld(sx, sy);
      for (let i = s.universe.nodes.length - 1; i >= 0; i--) {
        const n = s.universe.nodes[i];
        if (n.x === undefined || n.y === undefined) continue;
        const dx = n.x - world.x;
        const dy = n.y - world.y;
        if (dx * dx + dy * dy <= n.radius * n.radius) return n;
      }
      return null;
    };

    const pickOrbitNode = (wx: number, wy: number): SimulatedNode | null => {
      const cx = s.width / 2;
      const cy = s.height / 2;
      for (let i = s.orbit.nodes.length - 1; i >= 0; i--) {
        const node = s.orbit.nodes[i];
        const nx = (node.x ?? cx) - cx;
        const ny = (node.y ?? cy) - cy;
        const dx = wx - nx;
        const dy = wy - ny;
        const hr = node.radius * 1.3;
        if (dx * dx + dy * dy <= hr * hr) return node;
      }
      return null;
    };

    /* ── Draw universe ── */

    const drawUniverse = (opacity: number) => {
      const { transform: t, universe: u } = s;
      const now = performance.now();
      const elapsed = now - u.startTime;

      const bubbleFadeDuration = 600;
      const bridgeGrowDelay = bubbleFadeDuration;
      const bridgeGrowDuration = 800;

      if (u.initialized && u.fadeIn < 1) {
        u.fadeIn = Math.min(1, elapsed / bubbleFadeDuration);
      }

      const bridgeProgress = u.initialized
        ? Math.max(0, Math.min(1, (elapsed - bridgeGrowDelay) / bridgeGrowDuration))
        : 0;
      const easedBridge = easeOutCubic(bridgeProgress);
      const bubbleOpacity = u.fadeIn * opacity;

      if (!u.initialized || bubbleOpacity === 0) return;

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Links
      if (bridgeProgress > 0) {
        ctx.globalAlpha = opacity;
        for (let i = 0; i < u.links.length; i++) {
          const link = u.links[i];
          const src = link.source as UniverseNode;
          const tgt = link.target as UniverseNode;
          if (src.x === undefined || src.y === undefined || tgt.x === undefined || tgt.y === undefined) continue;

          const reversed = u.linkDirections[i] ?? false;
          const startX = reversed ? tgt.x : src.x;
          const startY = reversed ? tgt.y : src.y;
          const endX = reversed ? src.x : tgt.x;
          const endY = reversed ? src.y : tgt.y;

          const dx = endX - startX;
          const dy = endY - startY;

          ctx.beginPath();
          ctx.moveTo(startX, startY);
          ctx.lineTo(startX + dx * easedBridge, startY + dy * easedBridge);
          ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
          ctx.lineWidth = 1.5 / t.k;
          ctx.stroke();
        }
      }

      // Nodes
      ctx.globalAlpha = bubbleOpacity;
      for (const n of u.nodes) {
        if (n.x === undefined || n.y === undefined) continue;

        const isHovered = s.hoveredUniverseNode?.id === n.id;
        const radius = isHovered ? n.radius * 1.1 : n.radius;

        // During zoom-in, keep the target node visible, fade others
        if (s.mode === "zoom-in" && s.transition.targetNode) {
          const isTarget = n.id === s.transition.targetNode.id;
          if (!isTarget) {
            const elapsed = performance.now() - s.transition.startTime;
            const fadeStart = ZOOM_DURATION - FADE_OVERLAP;
            const fadeT = Math.max(0, Math.min(1, (elapsed - fadeStart) / FADE_OVERLAP));
            ctx.globalAlpha = bubbleOpacity * (1 - fadeT);
          } else {
            ctx.globalAlpha = bubbleOpacity;
          }
        }

        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();

        // Avatar
        const img = s.imageCache.get(n.avatarUrl ?? null);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(img, n.x - radius, n.y - radius, radius * 2, radius * 2);
          ctx.restore();
        }

        // Border
        ctx.beginPath();
        ctx.arc(n.x, n.y, radius, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = (isHovered ? 3 : 1.5) / t.k;
        ctx.stroke();

        // Reset alpha for next node
        ctx.globalAlpha = bubbleOpacity;
      }

      ctx.restore();
    };

    /* ── Draw orbit ── */

    const drawOrbit = (opacity: number) => {
      const { transform: t, orbit: o, width: w, height: h } = s;

      if (o.nodes.length === 0 && !o.centerLogoUrl && !o.centerName) return;

      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.translate(t.x, t.y);
      ctx.scale(t.k, t.k);

      // Draw orbit ring ellipses
      const ringLevels: OrbitLevel[] = ["ADVOCATE", "CONTRIBUTOR", "PARTICIPANT", "EXPLORER"];
      for (const level of ringLevels) {
        const rx = RING_RADII[level];
        const ry = rx * PERSPECTIVE_RATIO;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
        ctx.lineWidth = 1 / t.k;
        ctx.stroke();
      }

      // Center logo
      const logoImg = s.imageCache.get(o.centerLogoUrl);
      const r = CENTER_LOGO_RADIUS;

      if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logoImg, -r, -r, r * 2, r * 2);
        ctx.restore();

        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 2 / t.k;
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = "#3b82f6";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 2 / t.k;
        ctx.stroke();
      }

      // Community name below logo
      if (o.centerName) {
        ctx.font = `500 ${12 / t.k}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(o.centerName, 0, r + 14 / t.k);
      }

      // Draw member nodes
      const simCx = w / 2;
      const simCy = h / 2;

      for (const node of o.nodes) {
        const nx = (node.x ?? simCx) - simCx;
        const ny = (node.y ?? simCy) - simCy;
        const isHovered = node.id === s.hoveredOrbitNodeId;
        const nr = node.radius;

        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();

        // Avatar
        const avatarImg = s.imageCache.get(node.avatarUrl);
        if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(nx, ny, nr, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(avatarImg, nx - nr, ny - nr, nr * 2, nr * 2);
          ctx.restore();
        }

        // Border
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = (isHovered ? 3 : 1.5) / t.k;
        ctx.stroke();
      }

      ctx.restore();
    };

    /* ── Main frame ── */

    const frame = (now: number) => {
      if (!running) return;

      const { width: w, height: h, mode } = s;
      if (w === 0 || h === 0) {
        s.raf = requestAnimationFrame(frame);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      // Advance orbit rotation
      if ((mode === "orbit" || mode === "zoom-out") && s.orbit.simulation) {
        const dt = (now - lastOrbitTick) / 1000;
        if (!s.orbit.paused && mode === "orbit") {
          for (const level of Object.keys(ORBIT_ROTATION.SPEED_MULTIPLIER) as OrbitLevel[]) {
            s.orbit.ringRotation[level] ??= 0;
            s.orbit.ringRotation[level] +=
              dt * (ORBIT_ROTATION.BASE_SPEED / (Math.PI * 2)) * ORBIT_ROTATION.SPEED_MULTIPLIER[level];
          }
        }
        s.orbit.simulation.alpha(1);
      }
      lastOrbitTick = now;

      // Hover detection (universe mode only — orbit handled in pointer events)
      if (mode === "universe" && s.pointer.inside && !s.draggedNode) {
        const picked = pickUniverseNode(s.pointer.x, s.pointer.y);
        if (picked !== s.hoveredUniverseNode) {
          s.hoveredUniverseNode = picked;
          if (picked) {
            const tip: UniverseTooltipData = {
              name: picked.name,
              handle: picked.handle,
              memberCount: picked.memberCount,
              isPublic: picked.isPublic,
              isMembershipOpen: picked.isMembershipOpen,
              x: s.pointer.x,
              y: s.pointer.y,
            };
            setUniverseTooltip(tip);
          } else {
            setUniverseTooltip(null);
          }
        } else if (picked) {
          setUniverseTooltip((prev) =>
            prev ? { ...prev, x: s.pointer.x, y: s.pointer.y } : null,
          );
        }
      }

      switch (mode) {
        case "universe": {
          drawUniverse(1);
          break;
        }

        case "zoom-in": {
          const elapsed = now - s.transition.startTime;
          const rawT = Math.min(1, elapsed / ZOOM_DURATION);
          const t = easeInOutCubic(rawT);

          s.transform = {
            x: lerp(s.transition.transformFrom.x, s.transition.transformTo.x, t),
            y: lerp(s.transition.transformFrom.y, s.transition.transformTo.y, t),
            k: lerp(s.transition.transformFrom.k, s.transition.transformTo.k, t),
          };

          drawUniverse(1);

          if (rawT >= 1) {
            // Zoom complete
            if (s.fetchedData) {
              startOrbitSimulation(s.fetchedData.members, s.fetchedData.links);
              s.mode = "orbit";
              setSceneMode("orbit");
              s.transform = { x: s.width / 2, y: s.height / 2, k: 1 };
            } else if (s.fetchError) {
              // Error — go back
              s.mode = "universe";
              setSceneMode("universe");
              s.transform = { ...s.savedUniverseTransform };
            } else {
              // Still loading
              s.mode = "loading";
              setSceneMode("loading");
            }
          }
          break;
        }

        case "loading": {
          // Keep showing the zoomed-in universe with the target bubble
          drawUniverse(1);

          // Draw a loading indicator at center
          const pulse = 0.5 + 0.5 * Math.sin(now / 300);
          ctx.save();
          ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + pulse * 0.3})`;
          ctx.beginPath();
          ctx.arc(s.width / 2, s.height / 2, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();

          // Check if data arrived
          if (s.fetchedData) {
            startOrbitSimulation(s.fetchedData.members, s.fetchedData.links);
            s.mode = "orbit";
            setSceneMode("orbit");
            s.transform = { x: s.width / 2, y: s.height / 2, k: 1 };
          } else if (s.fetchError) {
            s.mode = "universe";
            setSceneMode("universe");
            s.transform = { ...s.savedUniverseTransform };
          }
          break;
        }

        case "orbit": {
          drawOrbit(1);
          break;
        }

        case "zoom-out": {
          const elapsed = now - s.transition.startTime;
          const rawT = Math.min(1, elapsed / ZOOM_DURATION);
          const t = easeInOutCubic(rawT);

          s.transform = {
            x: lerp(s.transition.transformFrom.x, s.transition.transformTo.x, t),
            y: lerp(s.transition.transformFrom.y, s.transition.transformTo.y, t),
            k: lerp(s.transition.transformFrom.k, s.transition.transformTo.k, t),
          };

          // Fade universe in during last portion
          const universeOpacity = Math.max(0, Math.min(1, (rawT - 0.3) / 0.7));
          drawUniverse(universeOpacity);

          if (rawT >= 1) {
            s.mode = "universe";
            setSceneMode("universe");
            s.transform = { ...s.savedUniverseTransform };
          }
          break;
        }
      }

      s.raf = requestAnimationFrame(frame);
    };

    s.raf = requestAnimationFrame(frame);

    return () => {
      running = false;
      if (s.raf) cancelAnimationFrame(s.raf);
    };
  }, [startOrbitSimulation]);

  /* ────────────────────────────
     Pointer events
  ──────────────────────────── */

  const onPointerMove = React.useCallback((e: React.PointerEvent) => {
    const s = stateRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    s.pointer = { x, y, inside: true };

    if (s.mode === "universe") {
      if (s.draggedNode) {
        const t = s.transform;
        s.draggedNode.fx = (x - t.x) / t.k;
        s.draggedNode.fy = (y - t.y) / t.k;
      }
    } else if (s.mode === "orbit") {
      const drag = s.orbitDrag;

      if (drag?.type === "node") {
        drag.didMove = true;
        const t = s.transform;
        const wx = (x - t.x) / t.k;
        const wy = (y - t.y) / t.k;
        const cx = s.width / 2;
        const cy = s.height / 2;
        const node = s.orbit.nodes.find((n) => n.id === drag.nodeId);
        if (node) {
          node.fx = wx + cx;
          node.fy = wy + cy;
        }
        return;
      }

      if (drag?.type === "pan") {
        const dx = e.clientX - (drag.startX ?? 0);
        const dy = e.clientY - (drag.startY ?? 0);
        s.transform = {
          ...s.transform,
          x: (drag.startTx ?? 0) + dx,
          y: (drag.startTy ?? 0) + dy,
        };
        return;
      }

      // Hover detection for orbit nodes
      const t = s.transform;
      const wx = (x - t.x) / t.k;
      const wy = (y - t.y) / t.k;
      const hitNode = pickOrbitNode(wx, wy);
      const prevId = s.hoveredOrbitNodeId;
      const newId = hitNode?.id ?? null;

      if (newId !== prevId) {
        s.hoveredOrbitNodeId = newId;
        if (hitNode) {
          const nx = (hitNode.x ?? s.width / 2) - s.width / 2;
          const ny = (hitNode.y ?? s.height / 2) - s.height / 2;
          const screenX = nx * t.k + t.x + rect.left;
          const screenY = ny * t.k + t.y + rect.top;
          setOrbitTooltip({ node: hitNode, x: screenX, y: screenY });
        } else {
          setOrbitTooltip(null);
        }
      }
    }
  }, []);

  const pickOrbitNode = React.useCallback((wx: number, wy: number): SimulatedNode | null => {
    const s = stateRef.current;
    const cx = s.width / 2;
    const cy = s.height / 2;
    for (let i = s.orbit.nodes.length - 1; i >= 0; i--) {
      const node = s.orbit.nodes[i];
      const nx = (node.x ?? cx) - cx;
      const ny = (node.y ?? cy) - cy;
      const dx = wx - nx;
      const dy = wy - ny;
      const hr = node.radius * 1.3;
      if (dx * dx + dy * dy <= hr * hr) return node;
    }
    return null;
  }, []);

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    const s = stateRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    if (s.mode === "universe") {
      const t = s.transform;
      const wx = (x - t.x) / t.k;
      const wy = (y - t.y) / t.k;

      for (let i = s.universe.nodes.length - 1; i >= 0; i--) {
        const n = s.universe.nodes[i];
        if (n.x === undefined || n.y === undefined) continue;
        const dx = n.x - wx;
        const dy = n.y - wy;
        if (dx * dx + dy * dy <= n.radius * n.radius) {
          s.draggedNode = n;
          s.dragStart = { x: n.x, y: n.y };
          n.fx = n.x;
          n.fy = n.y;

          s.hoveredUniverseNode = null;
          setUniverseTooltip(null);
          s.universe.simulation?.alphaTarget(0.3).restart();
          return;
        }
      }
    } else if (s.mode === "orbit") {
      const t = s.transform;
      const wx = (x - t.x) / t.k;
      const wy = (y - t.y) / t.k;
      const hitNode = pickOrbitNode(wx, wy);

      if (hitNode) {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        s.orbitDrag = {
          type: "node",
          nodeId: hitNode.id,
          pointerId: e.pointerId,
          didMove: false,
        };
        const cx = s.width / 2;
        const cy = s.height / 2;
        hitNode.fx = (hitNode.x ?? cx);
        hitNode.fy = (hitNode.y ?? cy);
        return;
      }

      // Pan
      s.orbitDrag = {
        type: "pan",
        pointerId: e.pointerId,
        didMove: false,
        startX: e.clientX,
        startY: e.clientY,
        startTx: t.x,
        startTy: t.y,
      };
    }
  }, [pickOrbitNode]);

  const onPointerUp = React.useCallback((e: React.PointerEvent) => {
    const s = stateRef.current;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch { /* ignore */ }

    if (s.mode === "universe") {
      const draggedNode = s.draggedNode;
      const dragStart = s.dragStart;

      if (draggedNode && dragStart) {
        const dx = (draggedNode.x ?? 0) - dragStart.x;
        const dy = (draggedNode.y ?? 0) - dragStart.y;
        const moved = Math.hypot(dx, dy);

        s.universe.simulation?.alphaTarget(0);
        s.draggedNode = null;
        s.dragStart = null;

        if (moved < 5) {
          draggedNode.fx = null;
          draggedNode.fy = null;

          // Click on community — trigger zoom
          const community = communities.find((c) => c.id === draggedNode.id);
          if (community) {
            handleCommunityClick(community, draggedNode);
          }
        }
      }
    } else if (s.mode === "orbit") {
      const drag = s.orbitDrag;
      if (!drag) return;

      if (drag.type === "node") {
        const node = s.orbit.nodes.find((n) => n.id === drag.nodeId);
        if (node) {
          if (!drag.didMove) {
            // Click — show popover
            const t = s.transform;
            const cx = s.width / 2;
            const cy = s.height / 2;
            const nx = (node.x ?? cx) - cx;
            const ny = (node.y ?? cy) - cy;
            const screenX = nx * t.k + t.x + rect.left;
            const screenY = ny * t.k + t.y + rect.top;

            setOrbitPopover({ node, x: screenX, y: screenY });
            setOrbitTooltip(null);
            s.orbit.paused = true;
          }

          // Release — convert drop position back to baseT
          const cx = s.width / 2;
          const cy = s.height / 2;
          const ndx = (node.x ?? cx) - cx;
          const ndy = (node.y ?? cy) - cy;
          const rx = RING_RADII[node.orbitLevel];
          const ry = rx * PERSPECTIVE_RATIO;
          const table = getArcTable(rx);
          const angle = Math.atan2(ndy / ry, ndx / rx);
          const currentRotation = s.orbit.ringRotation[node.orbitLevel] ?? 0;
          node.baseT = table.angleToT(angle < 0 ? angle + Math.PI * 2 : angle) - currentRotation;
          node.fx = null;
          node.fy = null;
        }
      }

      s.orbitDrag = null;
    }
  }, [communities, handleCommunityClick]);

  const onPointerLeave = React.useCallback(() => {
    const s = stateRef.current;
    s.pointer.inside = false;

    if (s.mode === "universe") {
      if (s.hoveredUniverseNode) {
        s.hoveredUniverseNode = null;
        setUniverseTooltip(null);
      }
    } else if (s.mode === "orbit") {
      if (s.hoveredOrbitNodeId) {
        s.hoveredOrbitNodeId = null;
        setOrbitTooltip(null);
      }
    }
  }, []);

  const onWheel = React.useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    const s = stateRef.current;
    if (s.mode !== "universe" && s.mode !== "orbit") return;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const t = s.transform;
    const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;

    const minZoom = s.mode === "universe" ? 0.1 : INTERACTION.MIN_ZOOM;
    const maxZoom = s.mode === "universe" ? 10 : INTERACTION.MAX_ZOOM;
    const newK = Math.max(minZoom, Math.min(maxZoom, t.k * scaleFactor));

    const wx = (x - t.x) / t.k;
    const wy = (y - t.y) / t.k;

    s.transform = {
      k: newK,
      x: x - wx * newK,
      y: y - wy * newK,
    };
  }, []);

  /* ────────────────────────────
     Orbit popover handlers
  ──────────────────────────── */

  const handleClosePopover = React.useCallback(() => {
    const s = stateRef.current;
    setOrbitPopover(null);
    s.orbit.paused = false;
  }, []);

  const handleViewProfile = React.useCallback((memberId: string) => {
    setOrbitPopover(null);
    onMemberClickRef.current?.(memberId);
  }, []);

  /* ────────────────────────────
     Cursor
  ──────────────────────────── */

  const cursor = React.useMemo(() => {
    if (sceneMode === "universe") {
      return stateRef.current.hoveredUniverseNode ? "pointer" : "default";
    }
    if (sceneMode === "orbit") {
      return stateRef.current.hoveredOrbitNodeId ? "pointer" : "grab";
    }
    return "default";
  }, [sceneMode, universeTooltip, orbitTooltip]);

  /* ────────────────────────────
     Render
  ──────────────────────────── */

  const containerRect = containerRef.current?.getBoundingClientRect();

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
          cursor,
        }}
        aria-label="Orbit scene"
        role="img"
      />

      {/* Universe tooltip */}
      {universeTooltip && sceneMode === "universe" && (
        <UniverseTooltip data={universeTooltip} />
      )}

      {/* Orbit tooltip */}
      {orbitTooltip && sceneMode === "orbit" && containerRect && !orbitPopover && (
        <NodeTooltip
          node={orbitTooltip.node}
          x={orbitTooltip.x}
          y={orbitTooltip.y}
          containerRect={containerRect}
        />
      )}

      {/* Orbit popover */}
      {orbitPopover && sceneMode === "orbit" && (
        <NodePopover
          node={orbitPopover.node}
          x={orbitPopover.x}
          y={orbitPopover.y}
          onClose={handleClosePopover}
          onViewProfile={handleViewProfile}
        />
      )}

      {/* Back button */}
      {(sceneMode === "orbit" || sceneMode === "loading") && (
        <button
          onClick={handleBack}
          className="absolute left-4 top-4 z-50 flex items-center gap-2 rounded-lg border border-border bg-background/80 px-3 py-2 text-sm font-medium text-foreground backdrop-blur-md transition-colors hover:bg-muted"
        >
          <ArrowLeftIcon className="size-4" />
          <span>{stateRef.current.transition.targetCommunity?.name ?? "Back"}</span>
        </button>
      )}
    </div>
  );
}
