import {
  forceCollide,
  forceSimulation,
  type Simulation
} from "d3-force";
import {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback
} from "react";

import {
  SIMULATION,
  RING_RADII,
  PERSPECTIVE_RATIO,
  LEVEL_COLORS,
  NODE_RADIUS,
  ORBIT_ROTATION
} from "./constants";
import {
  EllipseArcTable,
  distributeEvenlyOnEllipse
} from "./ellipse-arc-distribution";
import type {
  OrbitMember,
  MemberLink,
  SimulatedNode,
  SimulatedLink,
  OrbitLevel
} from "./types";

/* ────────────────────────────
   Helpers
──────────────────────────── */

function computeRadius(reachScore: number): number {
  const t = Math.min(1, reachScore / 100);
  return NODE_RADIUS.MIN + t * (NODE_RADIUS.MAX - NODE_RADIUS.MIN);
}

/** One lookup table per ring level (cached by rx since ry = rx * PERSPECTIVE_RATIO) */
const arcTableCache = new Map<number, EllipseArcTable>();

function getArcTable(rx: number): EllipseArcTable {
  let table = arcTableCache.get(rx);
  if (!table) {
    table = new EllipseArcTable(rx, rx * PERSPECTIVE_RATIO);
    arcTableCache.set(rx, table);
  }
  return table;
}

function createNodes(members: OrbitMember[]): SimulatedNode[] {
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
      const radius = computeRadius(m.reachScore);

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
        radius,
        color,
        baseT: tValues[i],
      });
    }
  }

  return nodes;
}

/* ────────────────────────────
   Custom force: pull each node toward its rotating
   target position on the ellipse.

   Rotation happens in t-space (arc-length fraction 0–1),
   not angle-space. This guarantees equal spacing is
   maintained at ALL points on the ellipse during orbit.

   The force works as a stiff spring:
     1. Zero velocity (prevents accumulation / oscillation)
     2. Set velocity toward target (NOT position directly)
   This lets collision push back against the orbit pull,
   so nodes behave as solid objects that never overlap.
──────────────────────────── */

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

      // Zero velocity first — no accumulation from previous ticks
      node.vx = 0;
      node.vy = 0;

      // Set velocity toward target — collision can push back against this
      node.vx = (targetX - (node.x ?? cx)) * strength;
      node.vy = (targetY - (node.y ?? cy)) * strength;
    }
  }

  force.initialize = (n: SimulatedNode[]) => {
    nodes = n;
  };

  return force;
}

/* ────────────────────────────
   Hook
──────────────────────────── */

export function useOrbitSimulation(
  members: OrbitMember[],
  links: MemberLink[],
  centerX: number,
  centerY: number,
) {
  const simRef = useRef<Simulation<SimulatedNode, SimulatedLink> | null>(null);
  const nodesRef = useRef<SimulatedNode[]>([]);
  const [nodes, setNodes] = useState<SimulatedNode[]>([]);

  // Rotation state in t-space (0–1 per full revolution)
  const ringRotationRef = useRef<Record<string, number>>({});
  const pausedRef = useRef(false);
  const rafRef = useRef<number>(0);

  const memberIds = useMemo(() => members.map((m) => m.id).join(","), [members]);

  useEffect(() => {
    if (members.length === 0 || centerX === 0 || centerY === 0) {
      nodesRef.current = [];
      setNodes([]);
      return;
    }

    const created = createNodes(members);

    // Set initial positions on ellipse (no rotation yet)
    for (const n of created) {
      const rx = RING_RADII[n.orbitLevel];
      const ry = rx * PERSPECTIVE_RATIO;
      const table = getArcTable(rx);
      const angle = table.tToAngle(n.baseT);
      n.x = centerX + Math.cos(angle) * rx;
      n.y = centerY + Math.sin(angle) * ry;
    }

    nodesRef.current = created;
    setNodes(created);

    // Stop previous
    simRef.current?.stop();
    cancelAnimationFrame(rafRef.current);

    const sim = forceSimulation<SimulatedNode>(created)
      .alphaDecay(0)
      .alpha(1)
      .velocityDecay(SIMULATION.VELOCITY_DECAY)
      .force(
        "orbit",
        forceOrbitTargets(
          centerX,
          centerY,
          ringRotationRef.current,
          SIMULATION.RADIAL_STRENGTH,
        ),
      )
      .force(
        "collision",
        forceCollide<SimulatedNode>()
          .radius((d) => d.radius + SIMULATION.COLLISION_PADDING)
          .strength(SIMULATION.COLLISION_STRENGTH)
          .iterations(SIMULATION.COLLISION_ITERATIONS),
      )
      .on("tick", () => {
        // d3 mutates node.x/y in place — the rAF render loop
        // in orbit-canvas reads directly from the nodes.
      });

    simRef.current = sim;

    // Animation loop: advance rotation in t-space + keep simulation warm
    let last = performance.now();

    function tick(now: number) {
      const dt = (now - last) / 1000;
      last = now;

      if (!pausedRef.current) {
        // Rotation is in t-space: radians/sec ÷ 2π = revolutions/sec = Δt/sec
        for (const level of Object.keys(ORBIT_ROTATION.SPEED_MULTIPLIER) as OrbitLevel[]) {
          ringRotationRef.current[level] ??= 0;
          ringRotationRef.current[level] +=
            dt *
            (ORBIT_ROTATION.BASE_SPEED / (Math.PI * 2)) *
            ORBIT_ROTATION.SPEED_MULTIPLIER[level];
        }
      }

      sim.alpha(1);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      sim.stop();
      cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds, links, centerX, centerY]);

  const setPaused = useCallback((paused: boolean) => {
    pausedRef.current = paused;
  }, []);

  const updateNodePosition = useCallback((id: string, x: number, y: number) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    node.fx = x;
    node.fy = y;
  }, []);

  const releaseNode = useCallback((id: string) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;

    // Convert drop position back to t-space
    const dx = (node.x ?? centerX) - centerX;
    const dy = (node.y ?? centerY) - centerY;
    const rx = RING_RADII[node.orbitLevel];
    const ry = rx * PERSPECTIVE_RATIO;
    const table = getArcTable(rx);

    // atan2 on normalized coords gives the ellipse angle
    const angle = Math.atan2(dy / ry, dx / rx);
    const currentRotation = ringRotationRef.current[node.orbitLevel] ?? 0;

    // Convert angle → t, subtract current rotation to get baseT
    node.baseT = table.angleToT(angle < 0 ? angle + Math.PI * 2 : angle) - currentRotation;

    node.fx = null;
    node.fy = null;
  }, [centerX, centerY]);

  return { nodes, setPaused, updateNodePosition, releaseNode };
}
