import { useEffect, useRef, useState, useCallback } from "react";
import {
  forceSimulation,
  forceLink,
  forceCollide,
  type Simulation,
} from "d3-force";

import type { OrbitMember, MemberLink, SimulatedNode, SimulatedLink, OrbitLevel } from "./types";
import {
  RING_RADII,
  LEVEL_TO_RING,
  LEVEL_COLORS,
  NODE_RADIUS,
  SIMULATION,
  ORBITAL_MOTION,
  INTERACTION,
} from "./constants";

/* ────────────────────────────
   Types
──────────────────────────── */

type UseOrbitSimulationOptions = {
  members: OrbitMember[];
  links: MemberLink[];
  width: number;
  height: number;
};

type UseOrbitSimulationReturn = {
  nodes: SimulatedNode[];
  links: SimulatedLink[];
  simulation: Simulation<SimulatedNode, SimulatedLink> | null;
  updateNodePosition: (nodeId: string, x: number, y: number, pin?: boolean) => void;
  unpinNode: (nodeId: string) => void;
  reheat: () => void;
  setRotationPaused: (paused: boolean) => void;
};

/* ────────────────────────────
   Custom Elliptical Force (Radial Only)

   This force only constrains the RADIAL distance from center,
   allowing free tangential (angular) motion for orbital rotation.
──────────────────────────── */

function forceElliptical<N extends SimulatedNode>(
  radiusX: (d: N) => number,
  radiusY: (d: N) => number,
  cx: number,
  cy: number,
  strength: number
) {
  let nodes: N[] = [];

  function force(alpha: number) {
    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue; // Skip pinned nodes

      const x = (node.x ?? cx) - cx;
      const y = (node.y ?? cy) - cy;

      // Target radii for this node's orbit level
      const targetRx = radiusX(node);
      const targetRy = radiusY(node);

      // Current distance from center
      const currentDist = Math.sqrt(x * x + y * y);

      // If node is at center, give it a random push outward
      if (currentDist < 1) {
        const randomAngle = Math.random() * Math.PI * 2;
        node.vx = (node.vx ?? 0) + Math.cos(randomAngle) * 10 * alpha;
        node.vy = (node.vy ?? 0) + Math.sin(randomAngle) * 10 * alpha;
        continue;
      }

      // Calculate angle using normalized ellipse coordinates
      const angle = Math.atan2(y / targetRy, x / targetRx);

      // Target position on the ellipse at the CURRENT angle
      const targetX = Math.cos(angle) * targetRx;
      const targetY = Math.sin(angle) * targetRy;
      const targetDist = Math.sqrt(targetX * targetX + targetY * targetY);

      // Calculate how far off we are from the ellipse (radial error only)
      const radialError = targetDist - currentDist;

      // Apply force only in the RADIAL direction (toward/away from center)
      // This preserves tangential motion for orbital rotation
      const radialUnitX = x / currentDist;
      const radialUnitY = y / currentDist;

      node.vx = (node.vx ?? 0) + radialUnitX * radialError * strength * alpha;
      node.vy = (node.vy ?? 0) + radialUnitY * radialError * strength * alpha;
    }
  }

  force.initialize = (n: N[]) => {
    nodes = n;
  };

  return force;
}

/* ────────────────────────────
   Custom Orbital (Tangential) Force

   Applies a constant tangential velocity to create orbital motion.
   Does NOT depend on alpha so rotation continues even when simulation cools.
──────────────────────────── */

interface OrbitalForce<N extends SimulatedNode> {
  (alpha: number): void;
  initialize: (nodes: N[]) => void;
  paused: (value?: boolean) => boolean | OrbitalForce<N>;
  speedMultiplier: (value?: number) => number | OrbitalForce<N>;
}

function forceOrbitalRotation<N extends SimulatedNode>(
  cx: number,
  cy: number,
  strength: number
): OrbitalForce<N> {
  let nodes: N[] = [];
  let paused = false;
  let speedMult = 1; // 0 = stopped, 1 = full speed

  const force: OrbitalForce<N> = (_alpha: number) => {
    // Skip orbital motion when paused or speed is zero
    if (paused || speedMult <= 0) return;

    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;

      const x = (node.x ?? cx) - cx;
      const y = (node.y ?? cy) - cy;

      const r = Math.sqrt(x * x + y * y);
      if (r === 0) continue;

      // Radial unit vector (outward from center)
      const rx = x / r;
      const ry = y / r;

      // Tangential unit vector (clockwise: perpendicular to radial)
      const tx = -ry;
      const ty = rx;

      // Current velocity
      let vx = node.vx ?? 0;
      let vy = node.vy ?? 0;

      // Dampen radial velocity (prevents bouncing from collisions)
      // but don't eliminate it completely - allows some organic variation
      const vr = vx * rx + vy * ry; // radial component
      const radialDamping = 0.8; // Remove 80% of radial velocity each tick
      vx -= vr * rx * radialDamping;
      vy -= vr * ry * radialDamping;

      const ringMultiplier =
        ORBITAL_MOTION.RING_SPEED_MULTIPLIER[node.orbitLevel] ?? 1;

      const orbitalImpulse =
        ORBITAL_MOTION.ANGULAR_VELOCITY * ringMultiplier * speedMult * strength;

      // Add orbital impulse in tangent direction
      // velocityDecay in simulation will naturally limit accumulation
      vx += tx * orbitalImpulse;
      vy += ty * orbitalImpulse;

      node.vx = vx;
      node.vy = vy;
    }
  };

  force.initialize = (n: N[]) => {
    nodes = n;
  };

  force.paused = (value?: boolean) => {
    if (value === undefined) return paused;
    paused = value;
    return force;
  };

  force.speedMultiplier = (value?: number) => {
    if (value === undefined) return speedMult;
    speedMult = Math.max(0, Math.min(1, value)); // Clamp 0-1
    return force;
  };

  return force;
}

/* ────────────────────────────
   Helpers
──────────────────────────── */

function computeRadius(reachScore: number): number {
  const t = Math.min(1, reachScore / 100);
  return NODE_RADIUS.MIN + t * (NODE_RADIUS.MAX - NODE_RADIUS.MIN);
}

/**
 * Calculate the angular spacing needed for a node on an ellipse
 * to maintain minimum gap from adjacent nodes
 */
function calculateAngularSpacing(
  nodeRadius: number,
  radiusX: number,
  radiusY: number,
  minGap: number
): number {
  // Use average radius for approximation (ellipse arc length varies)
  const avgRadius = (radiusX + radiusY) / 2;
  // Total space needed = node diameter + gap
  const spaceNeeded = nodeRadius * 2 + minGap;
  // Convert to radians
  return spaceNeeded / avgRadius;
}

/**
 * Group members by orbit level and pre-calculate their radii
 */
function groupMembersByLevel(members: OrbitMember[]): Map<OrbitLevel, { member: OrbitMember; radius: number }[]> {
  const groups = new Map<OrbitLevel, { member: OrbitMember; radius: number }[]>();

  for (const m of members) {
    const radius = computeRadius(m.reachScore);
    const group = groups.get(m.orbitLevel) ?? [];
    group.push({ member: m, radius });
    groups.set(m.orbitLevel, group);
  }

  return groups;
}

function createNodes(
  members: OrbitMember[],
  centerX: number,
  centerY: number
): SimulatedNode[] {
  const perspectiveRatio = SIMULATION.PERSPECTIVE_RATIO;
  // Use collision padding for initial placement gap - keeps it consistent with runtime collision
  const minGap = SIMULATION.COLLISION_PADDING;

  // Group members by level
  const membersByLevel = groupMembersByLevel(members);
  const nodes: SimulatedNode[] = [];

  // Process each level
  for (const [level, levelMembers] of membersByLevel) {
    const ringRadiusX = RING_RADII[level];
    const ringRadiusY = ringRadiusX * perspectiveRatio;
    const ring = LEVEL_TO_RING[level];
    const color = LEVEL_COLORS[level];

    // Calculate total angular space needed for all nodes in this level
    let totalAngularSpace = 0;
    const angularSpacings: number[] = [];

    for (const { radius } of levelMembers) {
      const spacing = calculateAngularSpacing(radius, ringRadiusX, ringRadiusY, minGap);
      angularSpacings.push(spacing);
      totalAngularSpace += spacing;
    }

    // If nodes fit in one ring (2π radians), distribute evenly
    // Otherwise, create multiple concentric layers
    const maxAngle = Math.PI * 2;
    const needsMultipleLayers = totalAngularSpace > maxAngle * 0.95; // 95% to leave some breathing room

    if (!needsMultipleLayers) {
      // Single layer - distribute evenly around the ellipse
      const extraSpace = maxAngle - totalAngularSpace;
      const gapBonus = extraSpace / levelMembers.length;

      let currentAngle = 0;
      for (let i = 0; i < levelMembers.length; i++) {
        const { member, radius } = levelMembers[i];
        const halfSpacing = angularSpacings[i] / 2;

        // Place node at center of its allocated space
        const angle = currentAngle + halfSpacing;
        currentAngle += angularSpacings[i] + gapBonus;

        nodes.push({
          id: member.id,
          name: member.name,
          avatarUrl: member.avatarUrl ?? null,
          headline: member.headline ?? null,
          tags: member.tags ?? [],
          orbitLevel: member.orbitLevel,
          reachScore: member.reachScore,
          lastActiveAt: member.lastActiveAt ?? null,
          ring,
          radius,
          color,
          baseAngle: angle,
          x: centerX + Math.cos(angle) * ringRadiusX,
          y: centerY + Math.sin(angle) * ringRadiusY,
        });
      }
    } else {
      // Multiple layers needed - distribute across inner/outer offsets
      const layers: { radiusOffset: number; members: typeof levelMembers }[] = [];
      let remainingMembers = [...levelMembers];
      let layerOffset = 0;
      const layerSpacing = NODE_RADIUS.MAX * 2 + minGap;

      while (remainingMembers.length > 0) {
        const layerRadiusX = ringRadiusX + layerOffset;
        const layerRadiusY = ringRadiusY + layerOffset * perspectiveRatio;

        // Calculate how many nodes fit in this layer
        let layerAngularSpace = 0;
        const layerMembers: typeof levelMembers = [];

        for (const item of remainingMembers) {
          const spacing = calculateAngularSpacing(item.radius, layerRadiusX, layerRadiusY, minGap);
          if (layerAngularSpace + spacing <= maxAngle * 0.95) {
            layerAngularSpace += spacing;
            layerMembers.push(item);
          } else {
            break;
          }
        }

        // If no members fit, force at least one
        if (layerMembers.length === 0 && remainingMembers.length > 0) {
          layerMembers.push(remainingMembers[0]);
        }

        layers.push({ radiusOffset: layerOffset, members: layerMembers });
        remainingMembers = remainingMembers.slice(layerMembers.length);
        layerOffset += layerSpacing;
      }

      // Place nodes in each layer
      for (const layer of layers) {
        const layerRadiusX = ringRadiusX + layer.radiusOffset;
        const layerRadiusY = ringRadiusY + layer.radiusOffset * perspectiveRatio;

        let totalLayerSpace = 0;
        const layerSpacings: number[] = [];
        for (const { radius } of layer.members) {
          const spacing = calculateAngularSpacing(radius, layerRadiusX, layerRadiusY, minGap);
          layerSpacings.push(spacing);
          totalLayerSpace += spacing;
        }

        const extraSpace = maxAngle - totalLayerSpace;
        const gapBonus = extraSpace / layer.members.length;

        let currentAngle = 0;
        for (let i = 0; i < layer.members.length; i++) {
          const { member, radius } = layer.members[i];
          const halfSpacing = layerSpacings[i] / 2;

          const angle = currentAngle + halfSpacing;
          currentAngle += layerSpacings[i] + gapBonus;

          nodes.push({
            id: member.id,
            name: member.name,
            avatarUrl: member.avatarUrl ?? null,
            headline: member.headline ?? null,
            tags: member.tags ?? [],
            orbitLevel: member.orbitLevel,
            reachScore: member.reachScore,
            lastActiveAt: member.lastActiveAt ?? null,
            ring,
            radius,
            color,
            baseAngle: angle,
            x: centerX + Math.cos(angle) * layerRadiusX,
            y: centerY + Math.sin(angle) * layerRadiusY,
          });
        }
      }
    }
  }

  return nodes;
}

function createLinks(
  links: MemberLink[],
  nodeIds: Set<string>
): SimulatedLink[] {
  return links
    .filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target))
    .map((l) => ({
      source: l.source as unknown as SimulatedNode,
      target: l.target as unknown as SimulatedNode,
      weight: l.weight ?? 1,
    }));
}

/* ────────────────────────────
   Hook
──────────────────────────── */

export function useOrbitSimulation({
  members,
  links,
  width,
  height,
}: UseOrbitSimulationOptions): UseOrbitSimulationReturn {
  const [nodes, setNodes] = useState<SimulatedNode[]>([]);
  const [simulatedLinks, setSimulatedLinks] = useState<SimulatedLink[]>([]);

  const simulationRef = useRef<Simulation<SimulatedNode, SimulatedLink> | null>(null);
  const lastMemberIdsRef = useRef<string>("");
  const rotationPausedRef = useRef(false);
  const decelAnimationRef = useRef<number | null>(null);

  // Initialize or update simulation when members/dimensions change
  useEffect(() => {
    if (width === 0 || height === 0 || members.length === 0) {
      setNodes([]);
      setSimulatedLinks([]);
      return;
    }

    const memberIds = members.map((m) => m.id).join(",");
    const perspectiveRatio = SIMULATION.PERSPECTIVE_RATIO;

    if (memberIds === lastMemberIdsRef.current && nodes.length > 0) {
      // Just update center forces if only dimensions changed
      if (simulationRef.current) {
        const cx = width / 2;
        const cy = height / 2;
        simulationRef.current.force(
          "elliptical",
          forceElliptical<SimulatedNode>(
            (d) => RING_RADII[d.orbitLevel],
            (d) => RING_RADII[d.orbitLevel] * perspectiveRatio,
            cx,
            cy,
            SIMULATION.RADIAL_STRENGTH
          )
        );
        simulationRef.current.force(
          "orbit",
          forceOrbitalRotation<SimulatedNode>(
            cx,
            cy,
            ORBITAL_MOTION.ROTATION_STRENGTH
          )
        );
        simulationRef.current.alpha(0.3).restart();
      }
      return;
    }

    lastMemberIdsRef.current = memberIds;

    const cx = width / 2;
    const cy = height / 2;

    // Create nodes and links
    const newNodes = createNodes(members, cx, cy);
    const nodeIdSet = new Set(newNodes.map((n) => n.id));
    const newLinks = createLinks(links, nodeIdSet);

    // Stop existing simulation
    simulationRef.current?.stop();

    // Create new simulation with custom elliptical force
    const sim = forceSimulation<SimulatedNode>(newNodes)
      .force(
        "elliptical",
        forceElliptical<SimulatedNode>(
          (d) => RING_RADII[d.orbitLevel],
          (d) => RING_RADII[d.orbitLevel] * perspectiveRatio,
          cx,
          cy,
          SIMULATION.RADIAL_STRENGTH
        )
      )
      .force(
        "orbit",
        forceOrbitalRotation<SimulatedNode>(
          cx,
          cy,
          ORBITAL_MOTION.ROTATION_STRENGTH
        )
      )
      .force(
        "link",
        forceLink<SimulatedNode, SimulatedLink>(newLinks)
          .id((d) => d.id)
          .distance(SIMULATION.LINK_DISTANCE)
          .strength((l) => SIMULATION.LINK_STRENGTH * l.weight)
      )
      .force(
        "collide",
        forceCollide<SimulatedNode>()
          .radius((d) => d.radius + SIMULATION.COLLISION_PADDING)
          .strength(SIMULATION.COLLISION_STRENGTH)
      )
      .alphaDecay(SIMULATION.ALPHA_DECAY)
      .velocityDecay(SIMULATION.VELOCITY_DECAY);
    sim.alphaTarget(0.12);

    // Update state on each tick
    sim.on("tick", () => {
      setNodes([...sim.nodes()]);
      setSimulatedLinks([...(sim.force("link") as any)?.links() ?? []]);
    });

    simulationRef.current = sim;

    // Initial state
    setNodes(newNodes);
    setSimulatedLinks(newLinks);

    return () => {
      sim.stop();
      // Clean up deceleration animation
      if (decelAnimationRef.current !== null) {
        cancelAnimationFrame(decelAnimationRef.current);
        decelAnimationRef.current = null;
      }
    };
  }, [members, links, width, height]);

  // Update node position (for dragging)
  const updateNodePosition = useCallback(
    (nodeId: string, x: number, y: number, pin = true) => {
      const sim = simulationRef.current;
      if (!sim) return;

      const node = sim.nodes().find((n) => n.id === nodeId);
      if (!node) return;

      node.fx = pin ? x : null;
      node.fy = pin ? y : null;
      node.x = x;
      node.y = y;

      // Restart simulation for collision physics during drag
      // Use low alpha to minimize disturbance to other nodes
      sim.alphaTarget(SIMULATION.DRAG_ALPHA).restart();
    },
    []
  );

  // Unpin a node
  const unpinNode = useCallback((nodeId: string) => {
    const sim = simulationRef.current;
    if (!sim) return;

    const node = sim.nodes().find((n) => n.id === nodeId);
    if (!node) return;

    node.fx = null;
    node.fy = null;

    // If rotation is paused, keep it paused (let the node settle without orbiting)
    // Otherwise resume full simulation with orbiting
    if (rotationPausedRef.current) {
      // Brief simulation to let the node settle, then go dormant
      sim.alphaTarget(0.05).restart();
      // After settling, go back to dormant state
      setTimeout(() => {
        if (rotationPausedRef.current && simulationRef.current) {
          simulationRef.current.alphaTarget(0).alpha(0.01);
        }
      }, 500);
    } else {
      sim.alphaTarget(0.12).restart();
    }
  }, []);

  // Reheat simulation
  const reheat = useCallback(() => {
    simulationRef.current?.alphaTarget(0.12).restart();
  }, []);

  // Pause/resume orbital rotation with smooth deceleration
  // When pausing: gradually decrease speed over ROTATION_DECEL_DURATION
  // When resuming: immediately restore full speed
  const setRotationPaused = useCallback((paused: boolean) => {
    rotationPausedRef.current = paused;

    const sim = simulationRef.current;
    if (!sim) return;

    const orbitForce = sim.force("orbit") as OrbitalForce<SimulatedNode> | null;
    if (!orbitForce) return;

    // Cancel any ongoing deceleration animation
    if (decelAnimationRef.current !== null) {
      cancelAnimationFrame(decelAnimationRef.current);
      decelAnimationRef.current = null;
    }

    if (paused) {
      // Gradually decelerate to a stop
      const duration = INTERACTION.ROTATION_DECEL_DURATION;
      const startTime = performance.now();
      const startSpeed = orbitForce.speedMultiplier() as number;

      const animate = (now: number) => {
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / duration);

        // Ease out curve for natural deceleration
        const easeOut = 1 - Math.pow(1 - progress, 2);
        const newSpeed = startSpeed * (1 - easeOut);

        orbitForce.speedMultiplier(newSpeed);

        if (progress < 1) {
          decelAnimationRef.current = requestAnimationFrame(animate);
        } else {
          // Fully stopped - zero out velocities and go dormant
          orbitForce.speedMultiplier(0);
          orbitForce.paused(true);

          for (const node of sim.nodes()) {
            node.vx = 0;
            node.vy = 0;
          }

          sim.alphaTarget(0).alpha(0.01);
          decelAnimationRef.current = null;
        }
      };

      decelAnimationRef.current = requestAnimationFrame(animate);
    } else {
      // Resume immediately at full speed
      orbitForce.paused(false);
      orbitForce.speedMultiplier(1);
      sim.alphaTarget(0.12).restart();
    }
  }, []);

  return {
    nodes,
    links: simulatedLinks,
    simulation: simulationRef.current,
    updateNodePosition,
    unpinNode,
    reheat,
    setRotationPaused,
  };
}
