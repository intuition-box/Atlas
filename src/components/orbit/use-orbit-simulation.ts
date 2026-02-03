import { useEffect, useRef, useState, useCallback } from "react";
import {
  forceSimulation,
  forceLink,
  forceManyBody,
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
  NODE_SPACING,
  ORBITAL_MOTION,
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

function forceOrbitalRotation<N extends SimulatedNode>(
  cx: number,
  cy: number,
  strength: number
) {
  let nodes: N[] = [];

  function force(_alpha: number) {
    for (const node of nodes) {
      if (node.fx != null || node.fy != null) continue;

      const x = (node.x ?? cx) - cx;
      const y = (node.y ?? cy) - cy;

      const r = Math.sqrt(x * x + y * y);
      if (r === 0) continue;

      // Perpendicular (tangential) unit vector (clockwise)
      // For clockwise rotation: tangent = (-y, x) normalized
      const tx = -y / r;
      const ty = x / r;

      const ringMultiplier =
        ORBITAL_MOTION.RING_SPEED_MULTIPLIER[node.orbitLevel] ?? 1;

      const angularVelocity =
        ORBITAL_MOTION.ANGULAR_VELOCITY * ringMultiplier;

      // Apply constant tangential velocity (not scaled by alpha)
      // This ensures continuous rotation regardless of simulation cooling
      node.vx = (node.vx ?? 0) + tx * angularVelocity * strength;
      node.vy = (node.vy ?? 0) + ty * angularVelocity * strength;
    }
  }

  force.initialize = (n: N[]) => {
    nodes = n;
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
  const minGap = NODE_SPACING.MIN_GAP;

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
      .force("charge", forceManyBody().strength(SIMULATION.CHARGE_STRENGTH))
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

    // Give the node a small push back toward its ring, keep simulation alive for orbiting
    sim.alphaTarget(0.12).restart();
  }, []);

  // Reheat simulation
  const reheat = useCallback(() => {
    simulationRef.current?.alphaTarget(0.12).restart();
  }, []);

  // Pause/resume orbital rotation (stops entire simulation to prevent jiggle)
  const setRotationPaused = useCallback((paused: boolean) => {
    const sim = simulationRef.current;
    if (!sim) return;

    if (paused) {
      // Stop the simulation entirely - this freezes all nodes in place
      sim.stop();
    } else {
      // Resume simulation with orbiting
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
