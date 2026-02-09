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

import { UsersIcon, PlusIcon, FileTextIcon, CogIcon } from "@/components/ui/icons";
import { apiGet } from "@/lib/api/client";
import { sounds } from "@/lib/sounds";
import { useNavigation, useNavigationContext, type NavigationControls } from "@/components/navigation/navigation-provider";
import {
  NodeTooltip,
  NodePopover,
  CommunityTooltipContent,
  MemberTooltipContent,
  MemberPopoverContent,
  CommunityPopoverContent,
} from "./node-popover";
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

type CommunityTooltipData = {
  name: string;
  memberCount: number;
  isPublic: boolean;
  isMembershipOpen: boolean;
  x: number;
  y: number;
  screenRadius: number;
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
const COMMUNITY_AVATAR_RADIUS = 32;
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
   Component
──────────────────────────── */

export function OrbitScene({
  communities,
  links = [],
  onMemberClick,
  className,
  style,
}: OrbitSceneProps) {
  const { setBreadcrumb } = useNavigationContext();
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
      communityAvatarUrl: null as string | null,
      communityName: "",
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
    hoveredCommunityAvatar: false,

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

    // Data fetch state
    fetchAbort: null as AbortController | null,
    fetchedData: null as {
      members: OrbitMember[];
      links: MemberLink[];
      isAdmin: boolean;
      description: string | null;
      viewerMembership: { status: string; role: string } | null;
    } | null,
    fetchError: null as string | null,
  });

  // React state for tooltips/popovers (need re-renders)
  const [communityTooltip, setCommunityTooltip] = React.useState<CommunityTooltipData | null>(null);
  const [memberTooltip, setMemberTooltip] = React.useState<{
    node: SimulatedNode;
    x: number;
    y: number;
    screenRadius: number;
  } | null>(null);
  const [memberPopover, setMemberPopover] = React.useState<{
    node: SimulatedNode;
    x: number;
    y: number;
    screenRadius: number;
  } | null>(null);
  const [communityPopover, setCommunityPopover] = React.useState<{
    x: number;
    y: number;
    screenRadius: number;
  } | null>(null);
  const [sceneMode, setSceneMode] = React.useState<SceneMode>("universe");
  const [activeCommunity, setActiveCommunity] = React.useState<{
    handle: string;
    name: string;
    isAdmin: boolean;
  } | null>(null);

  // Stable refs
  const onMemberClickRef = React.useRef(onMemberClick);
  onMemberClickRef.current = onMemberClick;

  /* ────────────────────────────
     Navigation controls

     Register bottom-left community controls when in orbit mode.
     Same controls as the standalone community page.
  ──────────────────────────── */

  const navigationControls = React.useMemo<NavigationControls>(() => {
    if (!activeCommunity) return {};

    const { handle, isAdmin } = activeCommunity;

    const bottomLeft = [
      { icon: UsersIcon, label: "Members", href: `/c/${handle}/members` },
      { icon: PlusIcon, label: "Apply", href: `/c/${handle}/apply` },
    ];

    const bottomRight = isAdmin
      ? [
          { icon: FileTextIcon, label: "Applications", href: `/c/${handle}/applications` },
          { icon: CogIcon, label: "Settings", href: `/c/${handle}/settings` },
        ]
      : [];

    return { bottomLeft, bottomRight };
  }, [activeCommunity]);

  useNavigation(navigationControls);

  /* ────────────────────────────
     Render scheduler

     Instead of an always-on rAF loop, each animation source
     schedules frames on demand. All sources share draw().
     Sources: d3 simulation ticks, orbit rotation, transitions,
     pointer interactions, resize.
  ──────────────────────────── */

  const schedulerRef = React.useRef({
    raf: null as number | null,
    running: true,
    rotationRaf: null as number | null,
  });

  /** Schedule a single draw on the next animation frame (coalesced). */
  const scheduleFrame = React.useCallback(() => {
    const sched = schedulerRef.current;
    if (!sched.running || sched.raf) return;
    sched.raf = requestAnimationFrame(() => {
      sched.raf = null;
      drawRef.current?.();
    });
  }, []);

  /** Exposed draw function — set by the render effect */
  const drawRef = React.useRef<(() => void) | null>(null);

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
      .force("collide", forceCollide<UniverseNode>().radius((d) => d.radius + 12).strength(1))
      .on("tick", () => {
        scheduleFrame();
      });

    s.universe.simulation = sim;

    if (!s.universe.initialized) {
      s.universe.initialized = true;
      s.universe.startTime = performance.now();
      s.universe.fadeIn = 0;
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
      } else if (s.universe.simulation && s.mode === "universe") {
        s.universe.simulation.force("x", forceX(w / 2).strength(0.04));
        s.universe.simulation.force("y", forceY(h / 2).strength(0.04));
      }
      scheduleFrame();
    };

    const ro = new ResizeObserver(handleResize);
    ro.observe(el);
    handleResize();
    return () => ro.disconnect();
  }, [initUniverse, scheduleFrame]);

  /* ────────────────────────────
     Orbit rotation loop

     Self-scheduling rAF that only runs when orbit is active
     and not paused. Advances ring rotation in t-space and
     re-warms the simulation so nodes follow their new targets.
  ──────────────────────────── */

  const startOrbitRotation = React.useCallback(() => {
    const sched = schedulerRef.current;
    // Don't start if already running
    if (sched.rotationRaf) return;

    let lastTick = performance.now();

    const tick = (now: number) => {
      sched.rotationRaf = null;
      const s = stateRef.current;

      // Stop if we're no longer in orbit mode
      if (s.mode !== "orbit") return;

      if (!s.orbit.paused) {
        const dt = (now - lastTick) / 1000;
        for (const level of Object.keys(ORBIT_ROTATION.SPEED_MULTIPLIER) as OrbitLevel[]) {
          s.orbit.ringRotation[level] ??= 0;
          s.orbit.ringRotation[level] +=
            dt * (ORBIT_ROTATION.BASE_SPEED / (Math.PI * 2)) * ORBIT_ROTATION.SPEED_MULTIPLIER[level];
        }
        // Re-warm simulation so nodes follow new rotation targets
        if (s.orbit.simulation) {
          s.orbit.simulation.alpha(Math.max(s.orbit.simulation.alpha(), 0.3));
          s.orbit.simulation.restart();
        }
      }
      lastTick = now;

      // Keep running while in orbit mode
      if (sched.running && s.mode === "orbit" && !s.orbit.paused) {
        sched.rotationRaf = requestAnimationFrame(tick);
      }
    };

    sched.rotationRaf = requestAnimationFrame(tick);
  }, []);

  const stopOrbitRotation = React.useCallback(() => {
    const sched = schedulerRef.current;
    if (sched.rotationRaf) {
      cancelAnimationFrame(sched.rotationRaf);
      sched.rotationRaf = null;
    }
  }, []);

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
    // Pause rotation if pointer is already inside the container
    s.orbit.paused = s.pointer.inside;
    s.orbit.fadeIn = 0;
    s.orbit.startTime = performance.now();

    // Load avatars
    for (const n of nodes) {
      if (n.avatarUrl) s.imageCache.get(n.avatarUrl);
    }

    // Load community avatar
    if (s.orbit.communityAvatarUrl) s.imageCache.get(s.orbit.communityAvatarUrl);

    s.orbit.simulation?.stop();

    const sim = forceSimulation<SimulatedNode>(nodes)
      .alphaDecay(SIMULATION.ALPHA_DECAY)
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
        // Simulation mutated positions — schedule a draw
        scheduleFrame();
      });

    s.orbit.simulation = sim;
    sounds.play("/sounds/drum.mp3");

    // Start orbit rotation loop
    startOrbitRotation();
  }, [scheduleFrame, startOrbitRotation]);

  /* ────────────────────────────
     Transition animation loop

     Temporary rAF loop that runs only during zoom-in/out
     transitions. Self-terminates when the animation completes.
     Each transition is identified by its startTime to prevent
     stale loops from interfering.
  ──────────────────────────── */

  const transitionRafRef = React.useRef<number | null>(null);

  const runTransition = React.useCallback(() => {
    // Cancel any existing transition loop
    if (transitionRafRef.current) {
      cancelAnimationFrame(transitionRafRef.current);
      transitionRafRef.current = null;
    }

    const s = stateRef.current;
    const sched = schedulerRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const tick = (now: number) => {
      if (!sched.running) return;
      transitionRafRef.current = null;

      const { mode } = s;
      if (s.width === 0 || s.height === 0) return;

      const elapsed = now - s.transition.startTime;
      const rawT = Math.min(1, elapsed / ZOOM_DURATION);
      const t = easeInOutCubic(rawT);

      // Interpolate transform
      s.transform = {
        x: lerp(s.transition.transformFrom.x, s.transition.transformTo.x, t),
        y: lerp(s.transition.transformFrom.y, s.transition.transformTo.y, t),
        k: lerp(s.transition.transformFrom.k, s.transition.transformTo.k, t),
      };

      // Draw via shared draw function (handles all modes + opacity)
      drawRef.current?.();

      if (rawT >= 1) {
        // Transition complete
        if (mode === "zoom-in") {
          if (s.fetchedData) {
            startOrbitSimulation(s.fetchedData.members, s.fetchedData.links);
            s.mode = "orbit";
            setSceneMode("orbit");
            setActiveCommunity({
              handle: s.transition.targetCommunity?.handle ?? "",
              name: s.transition.targetCommunity?.name ?? "",
              isAdmin: s.fetchedData.isAdmin,
            });
            s.transform = { x: s.width / 2, y: s.height / 2, k: 1 };
            scheduleFrame();
          } else if (s.fetchError) {
            s.mode = "universe";
            setSceneMode("universe");
            s.transform = { ...s.savedUniverseTransform };
            if (s.universe.simulation) {
              const targetNode = s.transition.targetNode;
              if (targetNode) { targetNode.fx = null; targetNode.fy = null; }
              s.universe.simulation.alphaTarget(0.1).restart();
              setTimeout(() => { s.universe.simulation?.alphaTarget(0); }, 500);
            }
          } else {
            s.mode = "loading";
            setSceneMode("loading");
            runLoadingLoop();
          }
        } else if (mode === "zoom-out") {
          s.mode = "universe";
          setSceneMode("universe");
          s.transform = { ...s.savedUniverseTransform };
          scheduleFrame();
        }
        return;
      }

      transitionRafRef.current = requestAnimationFrame(tick);
    };

    transitionRafRef.current = requestAnimationFrame(tick);
  }, [scheduleFrame, startOrbitSimulation]);

  /* ── Loading loop — pulsing indicator while waiting for data ── */

  const loadingRafRef = React.useRef<number | null>(null);

  const runLoadingLoop = React.useCallback(() => {
    if (loadingRafRef.current) {
      cancelAnimationFrame(loadingRafRef.current);
      loadingRafRef.current = null;
    }

    const s = stateRef.current;
    const sched = schedulerRef.current;

    const tick = () => {
      if (!sched.running || s.mode !== "loading") return;
      loadingRafRef.current = null;

      // Draw the zoomed-in universe via shared draw (target bubble pulses in drawUniverse)
      drawRef.current?.();

      // Check if data arrived
      if (s.fetchedData) {
        startOrbitSimulation(s.fetchedData.members, s.fetchedData.links);
        s.mode = "orbit";
        setSceneMode("orbit");
        setActiveCommunity({
          handle: s.transition.targetCommunity?.handle ?? "",
          name: s.transition.targetCommunity?.name ?? "",
          isAdmin: s.fetchedData.isAdmin,
        });
        s.transform = { x: s.width / 2, y: s.height / 2, k: 1 };
        scheduleFrame();
        return;
      }
      if (s.fetchError) {
        s.mode = "universe";
        setSceneMode("universe");
        s.transform = { ...s.savedUniverseTransform };
        if (s.universe.simulation) {
          const targetNode = s.transition.targetNode;
          if (targetNode) { targetNode.fx = null; targetNode.fy = null; }
          s.universe.simulation.alphaTarget(0.1).restart();
          setTimeout(() => { s.universe.simulation?.alphaTarget(0); }, 500);
        }
        return;
      }

      loadingRafRef.current = requestAnimationFrame(tick);
    };

    loadingRafRef.current = requestAnimationFrame(tick);
  }, [scheduleFrame, startOrbitSimulation]);

  /* ────────────────────────────
     Community click → zoom in
  ──────────────────────────── */

  const handleCommunityClick = React.useCallback((community: OrbitCommunity, node: UniverseNode) => {
    const s = stateRef.current;
    if (s.mode !== "universe") return;

    // Save current universe transform for zoom-out return
    s.savedUniverseTransform = { ...s.transform };

    // Pin the clicked node so it doesn't drift during zoom animation
    const nodeWorldX = node.x ?? s.width / 2;
    const nodeWorldY = node.y ?? s.height / 2;
    node.fx = nodeWorldX;
    node.fy = nodeWorldY;

    // Pause the universe simulation during zoom
    s.universe.simulation?.stop();

    // Calculate target transform: zoom so the clicked bubble fills center
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
    sounds.play("/sounds/whoosh.mp3", {volume: 0.3});

    // Clear tooltips
    s.hoveredUniverseNode = null;
    setCommunityTooltip(null);

    // Start fetching community data
    s.fetchAbort?.abort();
    const controller = new AbortController();
    s.fetchAbort = controller;
    s.fetchedData = null;
    s.fetchError = null;

    // Set orbit center info
    s.orbit.communityAvatarUrl = community.avatarUrl ?? null;
    s.orbit.communityName = community.name;

    // Start the transition animation loop
    runTransition();

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
          const isAdmin = result.value.isAdmin;
          const description = result.value.community.description ?? null;
          const viewerMembership = result.value.viewerMembership ?? null;
          s.fetchedData = { members, links: memberLinks, isAdmin, description, viewerMembership };

          // If zoom already finished and in loading state, transition now
          if (s.mode === "loading") {
            startOrbitSimulation(members, memberLinks);
            s.mode = "orbit";
            setSceneMode("orbit");
            setActiveCommunity({ handle: community.handle, name: community.name, isAdmin });
            s.transform = { x: s.width / 2, y: s.height / 2, k: 1 };
            scheduleFrame();
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
  }, [startOrbitSimulation, runTransition, scheduleFrame]);

  /* ────────────────────────────
     Back → zoom out
  ──────────────────────────── */

  const handleBack = React.useCallback(() => {
    const s = stateRef.current;
    if (s.mode !== "orbit" && s.mode !== "loading") return;

    // Stop orbit simulation + rotation
    s.orbit.simulation?.stop();
    s.orbit.simulation = null;
    s.orbit.nodes = [];
    stopOrbitRotation();

    // Clear orbit UI + navigation
    setMemberTooltip(null);
    setCommunityTooltip(null);
    setMemberPopover(null);
    setCommunityPopover(null);
    setActiveCommunity(null);

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

    // Unpin the target node so it returns to simulation control
    const targetNode = s.transition.targetNode;
    if (targetNode) {
      targetNode.fx = null;
      targetNode.fy = null;
    }

    // Resume universe simulation (will drive draws via on("tick"))
    if (s.universe.simulation) {
      s.universe.simulation.alphaTarget(0.1).restart();
      setTimeout(() => {
        s.universe.simulation?.alphaTarget(0);
      }, 500);
    }

    // Start the transition animation loop
    runTransition();
  }, [stopOrbitRotation, runTransition]);

  /* ────────────────────────────
     Breadcrumb — show community name in top-left nav
  ──────────────────────────── */

  React.useEffect(() => {
    if (activeCommunity) {
      setBreadcrumb({ label: activeCommunity.name, onBack: handleBack });
    } else {
      setBreadcrumb(null);
    }
    return () => setBreadcrumb(null);
  }, [activeCommunity, handleBack, setBreadcrumb]);

  /* ────────────────────────────
     Render effect

     Sets up the draw() function and canvas context.
     No always-on rAF loop — rendering is driven by:
     - D3 simulation ticks (universe/orbit) via on("tick")
     - Orbit rotation loop (self-scheduling rAF, only when unpaused)
     - Transition animations (temporary rAF loops)
     - Pointer/wheel events calling scheduleFrame()
  ──────────────────────────── */

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = stateRef.current;
    const sched = schedulerRef.current;
    sched.running = true;

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

      // Links (hidden during loading — only target bubble visible)
      if (bridgeProgress > 0 && s.mode !== "loading") {
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
        const radius = n.radius;

        // During zoom-in, keep the target node visible, fade others
        if ((s.mode === "zoom-in" || s.mode === "loading") && s.transition.targetNode) {
          const isTarget = n.id === s.transition.targetNode.id;
          if (!isTarget) {
            if (s.mode === "zoom-in") {
              const elapsed = performance.now() - s.transition.startTime;
              const fadeStart = ZOOM_DURATION - FADE_OVERLAP;
              const fadeT = Math.max(0, Math.min(1, (elapsed - fadeStart) / FADE_OVERLAP));
              ctx.globalAlpha = bubbleOpacity * (1 - fadeT);
            } else {
              // loading — non-target nodes fully hidden
              ctx.globalAlpha = 0;
            }
          } else if (s.mode === "loading") {
            // Pulse the target bubble while loading
            const pulse = 0.5 + 0.5 * Math.sin(now / 300);
            ctx.globalAlpha = bubbleOpacity * (0.4 + pulse * 0.6);
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

      if (o.nodes.length === 0 && !o.communityAvatarUrl && !o.communityName) return;

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

      // Community avatar
      const avatarImg = s.imageCache.get(o.communityAvatarUrl);
      const r = COMMUNITY_AVATAR_RADIUS;
      const isAvatarHovered = s.hoveredCommunityAvatar;

      if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatarImg, -r, -r, r * 2, r * 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = "#3b82f6";
        ctx.fill();
      }

      // Border — brighter + thicker on hover (same style as orbit nodes)
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = isAvatarHovered ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = (isAvatarHovered ? 3 : 2) / t.k;
      ctx.stroke();

      // Community name below logo
      if (o.communityName) {
        ctx.font = `500 ${12 / t.k}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(o.communityName, 0, r + 14 / t.k);
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
        const avatarImg = s.imageCache.get(node.avatarUrl ?? null);
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

    /* ── Shared draw — called by all animation sources ── */

    const draw = () => {
      const { width: w, height: h, mode } = s;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      switch (mode) {
        case "universe":
        case "zoom-in":
        case "loading":
          drawUniverse(1);
          break;
        case "orbit":
          drawOrbit(1);
          break;
        case "zoom-out": {
          // During zoom-out, fade universe in based on transition progress
          const elapsed = performance.now() - s.transition.startTime;
          const rawT = Math.min(1, elapsed / ZOOM_DURATION);
          const universeOpacity = Math.max(0, Math.min(1, (rawT - 0.3) / 0.7));
          drawUniverse(universeOpacity);
          break;
        }
      }
    };

    // Expose draw for scheduleFrame and transition loops
    drawRef.current = draw;

    // Initial draw
    draw();

    return () => {
      sched.running = false;
      if (sched.raf) { cancelAnimationFrame(sched.raf); sched.raf = null; }
      if (sched.rotationRaf) { cancelAnimationFrame(sched.rotationRaf); sched.rotationRaf = null; }
      if (transitionRafRef.current) { cancelAnimationFrame(transitionRafRef.current); transitionRafRef.current = null; }
      if (loadingRafRef.current) { cancelAnimationFrame(loadingRafRef.current); loadingRafRef.current = null; }
      drawRef.current = null;
      s.fetchAbort?.abort();
    };
  }, [stopOrbitRotation]);

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
      } else {
        // Hover detection — same pattern as orbit nodes
        const t = s.transform;
        const wx = (x - t.x) / t.k;
        const wy = (y - t.y) / t.k;

        let picked: UniverseNode | null = null;
        for (let i = s.universe.nodes.length - 1; i >= 0; i--) {
          const n = s.universe.nodes[i];
          if (n.x === undefined || n.y === undefined) continue;
          const dx = n.x - wx;
          const dy = n.y - wy;
          if (dx * dx + dy * dy <= n.radius * n.radius) { picked = n; break; }
        }

        if (picked !== s.hoveredUniverseNode) {
          s.hoveredUniverseNode = picked;
          if (picked && picked.x !== undefined && picked.y !== undefined) {
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
        }
      }
      scheduleFrame();
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
          // Keep simulation warm so it enforces fx/fy each tick
          if (s.orbit.simulation) {
            s.orbit.simulation.alpha(Math.max(s.orbit.simulation.alpha(), SIMULATION.DRAG_ALPHA));
            s.orbit.simulation.restart();
          }
        }
        scheduleFrame();
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
        scheduleFrame();
        return;
      }

      // Hover detection for orbit nodes
      const t = s.transform;
      const wx = (x - t.x) / t.k;
      const wy = (y - t.y) / t.k;
      const hitNode = findOrbitNodeAt(wx, wy);
      const prevId = s.hoveredOrbitNodeId;
      const newId = hitNode?.id ?? null;

      if (newId !== prevId) {
        s.hoveredOrbitNodeId = newId;
        if (hitNode) {
          const nx = (hitNode.x ?? s.width / 2) - s.width / 2;
          const ny = (hitNode.y ?? s.height / 2) - s.height / 2;
          const screenX = nx * t.k + t.x + rect.left;
          const screenY = ny * t.k + t.y + rect.top;
          setMemberTooltip({ node: hitNode, x: screenX, y: screenY, screenRadius: hitNode.radius * t.k + 1.5 });
        } else {
          setMemberTooltip(null);
        }
        scheduleFrame();
      }

      // Community avatar hover — tooltip + border glow (same pattern as orbit nodes)
      if (!hitNode) {
        const distSq = wx * wx + wy * wy;
        const hitRadius = COMMUNITY_AVATAR_RADIUS * 1.3;
        const wasHovered = s.hoveredCommunityAvatar;
        s.hoveredCommunityAvatar = distSq <= hitRadius * hitRadius;

        if (s.hoveredCommunityAvatar !== wasHovered) {
          if (s.hoveredCommunityAvatar) {
            const screenX = t.x + rect.left;
            const screenY = t.y + rect.top;
            setCommunityTooltip({
              name: s.orbit.communityName ?? "",
              memberCount: s.transition.targetCommunity?.memberCount ?? 0,
              isPublic: s.transition.targetCommunity?.isPublic ?? true,
              isMembershipOpen: s.transition.targetCommunity?.isMembershipOpen ?? false,
              x: screenX,
              y: screenY,
              screenRadius: COMMUNITY_AVATAR_RADIUS * t.k + 1.5,
            });
          } else {
            setCommunityTooltip(null);
          }
          scheduleFrame();
        }
      } else if (s.hoveredCommunityAvatar) {
        s.hoveredCommunityAvatar = false;
        setCommunityTooltip(null);
        scheduleFrame();
      }
    }
  }, [scheduleFrame]);

  /** Hit-test orbit nodes in world space */
  function findOrbitNodeAt(wx: number, wy: number): SimulatedNode | null {
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
  }

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
          setCommunityTooltip(null);
          s.universe.simulation?.alphaTarget(0.3).restart();
          scheduleFrame();
          return;
        }
      }
    } else if (s.mode === "orbit") {
      const t = s.transform;
      const wx = (x - t.x) / t.k;
      const wy = (y - t.y) / t.k;
      const hitNode = findOrbitNodeAt(wx, wy);

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
        // Warm the simulation so it ticks and enforces fx/fy
        s.orbit.simulation?.alpha(SIMULATION.DRAG_ALPHA).restart();
        setMemberTooltip(null);
        setCommunityTooltip(null);
        scheduleFrame();
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
      setCommunityTooltip(null);
    }
  }, [scheduleFrame]);

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

        // Always unpin so the node returns to simulation control
        draggedNode.fx = null;
        draggedNode.fy = null;

        if (moved < 5) {
          // Click on community — trigger zoom
          const community = communities.find((c) => c.id === draggedNode.id);
          if (community) {
            handleCommunityClick(community, draggedNode);
          }
        }
        scheduleFrame();
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

            setMemberPopover({ node, x: screenX, y: screenY, screenRadius: node.radius * t.k + 1.5 });
            setCommunityPopover(null);
            setMemberTooltip(null);
            setCommunityTooltip(null);
            s.orbit.paused = true;
            stopOrbitRotation();
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

      // Community avatar click — pan without movement means click on empty space
      if (drag?.type === "pan" && !drag.didMove) {
        const t = s.transform;
        const wx = (x - t.x) / t.k;
        const wy = (y - t.y) / t.k;
        const hitRadius = COMMUNITY_AVATAR_RADIUS * 1.3;
        if (wx * wx + wy * wy <= hitRadius * hitRadius) {
          const avatarScreenX = t.x + rect.left;
          const avatarScreenY = t.y + rect.top;
          setCommunityPopover({ x: avatarScreenX, y: avatarScreenY, screenRadius: COMMUNITY_AVATAR_RADIUS * t.k + 1.5 });
          setMemberPopover(null);
          setMemberTooltip(null);
          setCommunityTooltip(null);
          s.orbit.paused = true;
          stopOrbitRotation();
        }
      }

      s.orbitDrag = null;
      scheduleFrame();
    }
  }, [communities, handleCommunityClick, scheduleFrame, stopOrbitRotation]);

  const onPointerLeave = React.useCallback(() => {
    const s = stateRef.current;
    s.pointer.inside = false;

    if (s.mode === "universe") {
      if (s.hoveredUniverseNode) {
        s.hoveredUniverseNode = null;
        setCommunityTooltip(null);
        scheduleFrame();
      }
    } else if (s.mode === "orbit") {
      if (s.hoveredOrbitNodeId) {
        s.hoveredOrbitNodeId = null;
        setMemberTooltip(null);
        scheduleFrame();
      }
    }
  }, [scheduleFrame]);

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
    scheduleFrame();
  }, [scheduleFrame]);

  /* ────────────────────────────
     Orbit popover handlers
  ──────────────────────────── */

  const handleClosePopover = React.useCallback(() => {
    const s = stateRef.current;
    setMemberPopover(null);
    // Only unpause if mouse is outside the container
    if (!s.pointer.inside) {
      s.orbit.paused = false;
      startOrbitRotation();
    }
  }, [startOrbitRotation]);

  const handleCloseCommunityPopover = React.useCallback(() => {
    const s = stateRef.current;
    setCommunityPopover(null);
    if (!s.pointer.inside) {
      s.orbit.paused = false;
      startOrbitRotation();
    }
  }, [startOrbitRotation]);

  const handleViewProfile = React.useCallback((memberId: string) => {
    setMemberPopover(null);
    onMemberClickRef.current?.(memberId);
  }, []);

  /* ────────────────────────────
     Cursor — derived from React state (not stateRef) so it re-renders
  ──────────────────────────── */

  let cursor = "default";
  if (sceneMode === "universe") {
    cursor = communityTooltip ? "pointer" : "default";
  } else if (sceneMode === "orbit") {
    cursor = (memberTooltip || communityTooltip) ? "pointer" : "grab";
  }

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
      onMouseEnter={() => {
        const s = stateRef.current;
        s.pointer.inside = true;
        if (s.mode === "orbit") {
          s.orbit.paused = true;
          stopOrbitRotation();
          scheduleFrame(); // Redraw with updated hover state
        }
      }}
      onMouseLeave={() => {
        const s = stateRef.current;
        s.pointer.inside = false;
        if (s.mode === "orbit" && !memberPopover && !communityPopover) {
          s.orbit.paused = false;
          startOrbitRotation();
        }
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

      {/* Community tooltip — hover on community bubbles or center avatar */}
      {communityTooltip && !memberPopover && !communityPopover && (
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

      {/* Member tooltip — hover on orbit member nodes */}
      {memberTooltip && sceneMode === "orbit" && !memberPopover && !communityPopover && (
        <NodeTooltip
          x={memberTooltip.x}
          y={memberTooltip.y}
          screenRadius={memberTooltip.screenRadius}
        >
          <MemberTooltipContent node={memberTooltip.node} />
        </NodeTooltip>
      )}

      {/* Orbit popover — click on member nodes */}
      {memberPopover && sceneMode === "orbit" && (
        <NodePopover
          x={memberPopover.x}
          y={memberPopover.y}
          screenRadius={memberPopover.screenRadius}
          onClose={handleClosePopover}
        >
          <MemberPopoverContent
            node={memberPopover.node}
            onViewProfile={handleViewProfile}
          />
        </NodePopover>
      )}

      {/* Community popover — click on center logo */}
      {communityPopover && sceneMode === "orbit" && stateRef.current.transition.targetCommunity && (
        <NodePopover
          x={communityPopover.x}
          y={communityPopover.y}
          screenRadius={communityPopover.screenRadius}
          onClose={handleCloseCommunityPopover}
        >
          <CommunityPopoverContent
            community={{
              ...stateRef.current.transition.targetCommunity,
              description: stateRef.current.fetchedData?.description ?? null,
              viewerMembership: stateRef.current.fetchedData?.viewerMembership ?? null,
            }}
          />
        </NodePopover>
      )}

    </div>
  );
}
