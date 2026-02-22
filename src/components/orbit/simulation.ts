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
        gravityScore: m.gravityScore,
        lastActiveAt: m.lastActiveAt ?? null,
        joinedAt: m.joinedAt ?? null,
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
    if (strength === 0) return;

    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;

      const rx = RING_RADII[node.orbitLevel];
      const ry = rx * PERSPECTIVE_RATIO;
      const table = getArcTable(rx);

      const effectiveT =
        (node.baseT + (ringRotation[node.orbitLevel] ?? 0)) % 1;
      const angle = table.tToAngle(effectiveT);

      const targetX = cx + Math.cos(angle) * rx;
      const targetY = cy + Math.sin(angle) * ry;

      // Reset velocity each tick — orbit force acts as a constraint, not inertia
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

   Mirrors scene.tsx orbit lifecycle exactly:
   - alphaDecay = SIMULATION.ALPHA_DECAY (0.02)
   - Separate rotation rAF loop (only runs when unpaused)
   - Rotation tick re-warms simulation: sim.alpha(max(alpha, 0.3)).restart()
   - Drag warms simulation: sim.alpha(DRAG_ALPHA).restart()
   - Pause stops rotation loop; unpause restarts it
──────────────────────────── */

export function useOrbitSimulation(
  members: OrbitMember[],
  links: MemberLink[],
  centerX: number,
  centerY: number,
  /** When true, nodes start at center and expand outward via the force simulation */
  startFromCenter = false,
) {
  const simRef = useRef<Simulation<SimulatedNode, SimulatedLink> | null>(null);
  const nodesRef = useRef<SimulatedNode[]>([]);
  const [nodes, setNodes] = useState<SimulatedNode[]>([]);

  // Rotation state in t-space (0–1 per full revolution)
  const ringRotationRef = useRef<Record<string, number>>({});
  const pausedRef = useRef(false);
  // Rotation rAF — separate from d3's internal timer (matches scene.tsx)
  const rotationRafRef = useRef<number>(0);
  // Track if the component is still mounted
  const runningRef = useRef(true);

  const memberIds = useMemo(() => members.map((m) => m.id).join(","), [members]);

  /* ── Start rotation loop (matches scene.tsx startOrbitRotation) ── */

  const startRotationLoop = useCallback(() => {
    // Don't start if already running
    if (rotationRafRef.current) return;

    let lastTick = performance.now();

    const tick = (now: number) => {
      rotationRafRef.current = 0;
      if (!runningRef.current) return;

      const sim = simRef.current;
      if (!sim) return;

      if (!pausedRef.current) {
        const dt = (now - lastTick) / 1000;
        for (const level of Object.keys(ORBIT_ROTATION.SPEED_MULTIPLIER) as OrbitLevel[]) {
          ringRotationRef.current[level] ??= 0;
          ringRotationRef.current[level] +=
            dt * (ORBIT_ROTATION.BASE_SPEED / (Math.PI * 2)) * ORBIT_ROTATION.SPEED_MULTIPLIER[level];
        }

        // Re-warm simulation so nodes follow new rotation targets
        // (matches scene.tsx line 685-688)
        sim.alpha(Math.max(sim.alpha(), 0.3));
        sim.restart();
      }

      lastTick = now;

      // Keep running while unpaused (matches scene.tsx line 693-695)
      if (runningRef.current && !pausedRef.current) {
        rotationRafRef.current = requestAnimationFrame(tick);
      }
    };

    rotationRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRotationLoop = useCallback(() => {
    if (rotationRafRef.current) {
      cancelAnimationFrame(rotationRafRef.current);
      rotationRafRef.current = 0;
    }
  }, []);

  /* ── Create simulation ── */

  useEffect(() => {
    runningRef.current = true;

    if (members.length === 0 || centerX === 0 || centerY === 0) {
      nodesRef.current = [];
      setNodes([]);
      return;
    }

    const created = createNodes(members);

    if (startFromCenter) {
      // Start all nodes at center — force simulation pulls them outward (expansion effect)
      for (const n of created) {
        n.x = centerX;
        n.y = centerY;
      }
    } else {
      // Set initial positions on ellipse (no rotation yet)
      for (const n of created) {
        const rx = RING_RADII[n.orbitLevel];
        const ry = rx * PERSPECTIVE_RATIO;
        const table = getArcTable(rx);
        const angle = table.tToAngle(n.baseT);
        n.x = centerX + Math.cos(angle) * rx;
        n.y = centerY + Math.sin(angle) * ry;
      }
    }

    nodesRef.current = created;
    setNodes(created);
    ringRotationRef.current = {};

    // Stop previous
    simRef.current?.stop();
    stopRotationLoop();

    // Create simulation (matches scene.tsx startOrbitSimulation lines 744-762)
    const sim = forceSimulation<SimulatedNode>(created)
      .alphaDecay(SIMULATION.ALPHA_DECAY)
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

    // Start rotation loop (separate rAF, matches scene.tsx line 768)
    if (!pausedRef.current) {
      startRotationLoop();
    }

    return () => {
      runningRef.current = false;
      sim.stop();
      stopRotationLoop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberIds, links, centerX, centerY, startRotationLoop, stopRotationLoop]);

  /* ── Pause/resume (matches scene.tsx mouseEnter/mouseLeave + popover close) ── */

  const setPaused = useCallback((paused: boolean) => {
    const wasPaused = pausedRef.current;
    pausedRef.current = paused;

    if (paused && !wasPaused) {
      // Pause: stop rotation loop (simulation cools via alphaDecay)
      stopRotationLoop();
    } else if (!paused && wasPaused) {
      // Unpause: restart rotation loop + warm simulation
      if (simRef.current) {
        simRef.current.alpha(0.3).restart();
      }
      startRotationLoop();
    }
  }, [startRotationLoop, stopRotationLoop]);

  /* ── Drag: warm simulation so nodes respond to fx/fy ── */

  const updateNodePosition = useCallback((id: string, x: number, y: number) => {
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    node.fx = x;
    node.fy = y;

    // Warm simulation during drag (matches scene.tsx line 1440-1443 + 1585)
    const sim = simRef.current;
    if (sim) {
      sim.alpha(Math.max(sim.alpha(), SIMULATION.DRAG_ALPHA));
      sim.restart();
    }
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
    const rawT =
      table.angleToT(angle < 0 ? angle + Math.PI * 2 : angle) - currentRotation;

    // Clamp to [0,1) to avoid drift / negative wrap
    node.baseT = ((rawT % 1) + 1) % 1;

    node.fx = null;
    node.fy = null;
  }, [centerX, centerY]);

  return { nodes, setPaused, updateNodePosition, releaseNode };
}
