"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { SimulatedNode, SimulatedLink, OrbitCanvasProps, OrbitLevel } from "./types";
import {
  RING_RADII,
  RING_LABELS,
  ANIMATION,
  INTERACTION,
  SIMULATION,
} from "./constants";

/* ────────────────────────────
   Types
──────────────────────────── */

type Transform = {
  x: number;
  y: number;
  k: number;
};

type DragState =
  | { type: "none" }
  | { type: "node"; node: SimulatedNode; pointerId: number }
  | { type: "pan"; startX: number; startY: number; startTransformX: number; startTransformY: number; pointerId: number };

type RingLabelOpacities = Record<OrbitLevel, number>;

/* ────────────────────────────
   Helpers
──────────────────────────── */

function screenToWorld(
  screenX: number,
  screenY: number,
  transform: Transform,
  rect: DOMRect
): { x: number; y: number } {
  const canvasX = screenX - rect.left;
  const canvasY = screenY - rect.top;
  return {
    x: (canvasX - transform.x) / transform.k,
    y: (canvasY - transform.y) / transform.k,
  };
}

function worldToScreen(
  worldX: number,
  worldY: number,
  transform: Transform
): { x: number; y: number } {
  return {
    x: worldX * transform.k + transform.x,
    y: worldY * transform.k + transform.y,
  };
}

function getNodePosition(
  node: SimulatedNode,
  centerX: number,
  centerY: number
): { x: number; y: number } {
  // Use simulation x/y positions directly (relative to center)
  return {
    x: (node.x ?? centerX) - centerX,
    y: (node.y ?? centerY) - centerY,
  };
}

function findNodeAtPoint(
  nodes: SimulatedNode[],
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  hitRadiusMultiplier = 1.3
): SimulatedNode | null {
  // Search in reverse to find topmost node first
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const pos = getNodePosition(node, centerX, centerY);
    const dx = x - pos.x;
    const dy = y - pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist <= node.radius * hitRadiusMultiplier) {
      return node;
    }
  }
  return null;
}

function findHoveredRing(
  x: number,
  y: number,
  perspectiveRatio: number,
  ringThreshold = 20
): OrbitLevel | null {
  const orbitLevels: OrbitLevel[] = ["ADVOCATE", "CONTRIBUTOR", "PARTICIPANT", "EXPLORER"];

  for (const level of orbitLevels) {
    const radiusX = RING_RADII[level];
    const radiusY = radiusX * perspectiveRatio;

    // Calculate distance from point to ellipse
    const normalizedDist = Math.sqrt((x * x) / (radiusX * radiusX) + (y * y) / (radiusY * radiusY));
    const distFromRing = Math.abs(normalizedDist - 1) * Math.min(radiusX, radiusY);

    if (distFromRing < ringThreshold) {
      return level;
    }
  }

  return null;
}

/* ────────────────────────────
   Component
──────────────────────────── */

export function OrbitCanvas({
  nodes,
  links,
  width,
  height,
  centerLogoUrl,
  centerName,
  onNodeClick,
  onNodeHover,
  onNodeDragStart,
  onNodeDrag,
  onNodeDragEnd,
  onHoverChange,
  onNodeHoverChange,
  className = "",
}: OrbitCanvasProps & { onNodeHoverChange?: (isHovering: boolean) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const dragRef = useRef<DragState>({ type: "none" });
  const hoveredNodeRef = useRef<SimulatedNode | null>(null);
  const imageCache = useRef<Map<string, HTMLImageElement>>(new Map());
  const centerLogoRef = useRef<HTMLImageElement | null>(null);

  // Animation state
  const animationStartRef = useRef<number>(0);
  const prevNodesLengthRef = useRef(0);

  // Ring label opacity state (for fade in/out)
  const ringLabelOpacitiesRef = useRef<RingLabelOpacities>({
    ADVOCATE: 0,
    CONTRIBUTOR: 0,
    PARTICIPANT: 0,
    EXPLORER: 0,
  });
  const hoveredRingRef = useRef<OrbitLevel | null>(null);

  // Center transform when dimensions change
  useEffect(() => {
    if (width > 0 && height > 0) {
      transformRef.current = {
        x: width / 2,
        y: height / 2,
        k: 1,
      };
    }
  }, [width, height]);

  // Reset animation when nodes change
  useEffect(() => {
    if (nodes.length > 0 && nodes.length !== prevNodesLengthRef.current) {
      animationStartRef.current = performance.now();
      prevNodesLengthRef.current = nodes.length;
    }
  }, [nodes.length]);

  // Preload avatar images
  useEffect(() => {
    nodes.forEach((node) => {
      if (node.avatarUrl && !imageCache.current.has(node.avatarUrl)) {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = node.avatarUrl;
        imageCache.current.set(node.avatarUrl, img);
      }
    });
  }, [nodes]);

  // Track when center logo is loaded to trigger re-render
  const [centerLogoLoaded, setCenterLogoLoaded] = useState(false);

  // Load center logo
  useEffect(() => {
    if (centerLogoUrl) {
      setCenterLogoLoaded(false);
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = centerLogoUrl;
      img.onload = () => {
        centerLogoRef.current = img;
        setCenterLogoLoaded(true);
      };
      img.onerror = () => {
        console.warn("Failed to load center logo:", centerLogoUrl);
        centerLogoRef.current = null;
        setCenterLogoLoaded(true);
      };
    } else {
      centerLogoRef.current = null;
      setCenterLogoLoaded(true);
    }
  }, [centerLogoUrl]);

  // Main render function
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || width === 0 || height === 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    // Reset transform before applying DPR scaling
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(dpr, dpr);

    const transform = transformRef.current;
    const now = performance.now();
    const elapsed = now - animationStartRef.current;

    // Calculate animation progress
    const nodeProgress = Math.min(1, elapsed / ANIMATION.FADE_IN_DURATION);
    const bridgeElapsed = Math.max(0, elapsed - ANIMATION.BRIDGE_DELAY);
    const bridgeProgress = Math.min(1, bridgeElapsed / ANIMATION.BRIDGE_DURATION);

    // Update ring label opacities (fade in/out)
    const hoveredRing = hoveredRingRef.current;
    const fadeSpeed = 0.1;
    const orbitLevels: OrbitLevel[] = ["ADVOCATE", "CONTRIBUTOR", "PARTICIPANT", "EXPLORER"];
    orbitLevels.forEach((level) => {
      const currentOpacity = ringLabelOpacitiesRef.current[level];
      const targetOpacity = hoveredRing === level ? 1 : 0;
      if (currentOpacity < targetOpacity) {
        ringLabelOpacitiesRef.current[level] = Math.min(1, currentOpacity + fadeSpeed);
      } else if (currentOpacity > targetOpacity) {
        ringLabelOpacitiesRef.current[level] = Math.max(0, currentOpacity - fadeSpeed);
      }
    });

    const perspectiveRatio = SIMULATION.PERSPECTIVE_RATIO;

    // Clear canvas (transparent background)
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const centerX = 0;
    const centerY = 0;

    // Draw orbit rings as ellipses
    orbitLevels.forEach((level) => {
      const radiusX = RING_RADII[level];
      const radiusY = radiusX * perspectiveRatio;

      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
      ctx.lineWidth = 1 / transform.k;
      ctx.stroke();

      // Draw ring label with fade opacity
      const labelOpacity = ringLabelOpacitiesRef.current[level];
      if (labelOpacity > 0.01) {
        const label = RING_LABELS[level];
        ctx.font = `${10 / transform.k}px system-ui, sans-serif`;
        ctx.fillStyle = `rgba(148, 163, 184, ${0.8 * labelOpacity})`;
        ctx.textAlign = "center";
        ctx.fillText(label, centerX, centerY - radiusY - 6 / transform.k);
      }
    });

    // Draw center logo/avatar
    const centerLogoImg = centerLogoRef.current;
    const logoRadius = 32;
    const nameOffset = logoRadius + 14 / transform.k;

    if (centerLogoImg && centerLogoImg.complete && centerLogoImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, logoRadius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(
        centerLogoImg,
        centerX - logoRadius,
        centerY - logoRadius,
        logoRadius * 2,
        logoRadius * 2
      );
      ctx.restore();

      ctx.beginPath();
      ctx.arc(centerX, centerY, logoRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 2 / transform.k;
      ctx.stroke();
    } else {
      // Draw fallback with users icon
      ctx.beginPath();
      ctx.arc(centerX, centerY, logoRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#3b82f6";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 2 / transform.k;
      ctx.stroke();

      // Draw users icon
      ctx.save();
      ctx.fillStyle = "white";
      const iconScale = logoRadius / 16;
      ctx.translate(centerX, centerY);
      ctx.scale(iconScale, iconScale);
      ctx.beginPath();
      ctx.arc(0, -4, 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(0, 6, 5.5, 4, 0, Math.PI, 0, true);
      ctx.fill();
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(-8, -2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-8, 6, 4, 3, 0, Math.PI, 0, true);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(8, -2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(8, 6, 4, 3, 0, Math.PI, 0, true);
      ctx.fill();
      ctx.restore();
    }

    // Draw community name below the logo
    if (centerName) {
      ctx.font = `500 ${12 / transform.k}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(centerName, centerX, centerY + nameOffset);
    }

    // Draw links with animation
    if (bridgeProgress > 0) {
      links.forEach((link) => {
        const source = typeof link.source === "object" ? link.source : null;
        const target = typeof link.target === "object" ? link.target : null;
        if (!source || !target) return;

        const sourcePos = getNodePosition(source, width / 2, height / 2);
        const targetPos = getNodePosition(target, width / 2, height / 2);

        const dx = targetPos.x - sourcePos.x;
        const dy = targetPos.y - sourcePos.y;
        const currentX = sourcePos.x + dx * bridgeProgress;
        const currentY = sourcePos.y + dy * bridgeProgress;

        ctx.beginPath();
        ctx.moveTo(sourcePos.x, sourcePos.y);
        ctx.lineTo(currentX, currentY);
        ctx.strokeStyle = `rgba(148, 163, 184, ${0.3 * bridgeProgress})`;
        ctx.lineWidth = (1 + link.weight * 0.5) / transform.k;
        ctx.stroke();
      });
    }

    // Draw nodes with animation (use simulation x/y positions)
    const hoveredNode = hoveredNodeRef.current;
    const draggedNode = dragRef.current.type === "node" ? dragRef.current.node : null;

    nodes.forEach((node) => {
      const pos = getNodePosition(node, width / 2, height / 2);
      const nx = pos.x;
      const ny = pos.y;

      const isHovered = hoveredNode?.id === node.id;
      const isDragged = draggedNode?.id === node.id;
      const scale = isHovered || isDragged ? INTERACTION.HOVER_SCALE : 1;
      const radius = node.radius * scale;
      const alpha = nodeProgress;

      ctx.globalAlpha = alpha;

      // Node background circle (gray)
      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#374151";
      ctx.fill();

      // Avatar image or user icon fallback
      const avatarUrl = node.avatarUrl;
      const img = avatarUrl ? imageCache.current.get(avatarUrl) : null;
      if (img && img.complete && img.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(nx, ny, radius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, nx - radius, ny - radius, radius * 2, radius * 2);
        ctx.restore();
      } else {
        // Draw user icon fallback
        ctx.save();
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        const iconSize = radius * 1.2;
        ctx.translate(nx, ny);
        ctx.scale(iconSize / 24, iconSize / 24);
        ctx.beginPath();
        ctx.arc(0, -3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(0, 8, 7, 5, 0, Math.PI, 0, true);
        ctx.fill();
        ctx.restore();
      }

      // Border (always visible, brighter on hover/drag)
      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);
      ctx.strokeStyle = isHovered || isDragged ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = (isHovered || isDragged ? 3 : 1.5) / transform.k;
      ctx.stroke();

      ctx.globalAlpha = 1;
    });

    ctx.restore();

    animationRef.current = requestAnimationFrame(render);
  }, [nodes, links, width, height, centerLogoUrl, centerLogoLoaded, centerName]);

  // Start continuous render loop
  useEffect(() => {
    animationRef.current = requestAnimationFrame(render);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [render]);

  // Pointer event handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(e.clientX, e.clientY, transformRef.current, rect);
      const node = findNodeAtPoint(nodes, world.x, world.y, width / 2, height / 2);

      canvas.setPointerCapture(e.pointerId);

      if (node) {
        dragRef.current = {
          type: "node",
          node,
          pointerId: e.pointerId,
        };
        canvas.style.cursor = "grabbing";

        if (onNodeDragStart) {
          onNodeDragStart(node.id);
        }

        if (onNodeHover) {
          onNodeHover(null, { x: 0, y: 0 });
        }
      } else {
        dragRef.current = {
          type: "pan",
          startX: e.clientX,
          startY: e.clientY,
          startTransformX: transformRef.current.x,
          startTransformY: transformRef.current.y,
          pointerId: e.pointerId,
        };
        canvas.style.cursor = "grabbing";
      }
    },
    [nodes, width, height, onNodeDragStart, onNodeHover]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const drag = dragRef.current;
      const centerX = width / 2;
      const centerY = height / 2;

      if (drag.type === "node") {
        // Dragging a node - update position via simulation
        const world = screenToWorld(e.clientX, e.clientY, transformRef.current, rect);
        if (onNodeDrag) {
          // Convert world coords (relative to center) back to absolute coords for simulation
          onNodeDrag(drag.node.id, world.x + centerX, world.y + centerY);
        }
      } else if (drag.type === "pan") {
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        transformRef.current = {
          ...transformRef.current,
          x: drag.startTransformX + dx,
          y: drag.startTransformY + dy,
        };
      } else {
        // Not dragging - check for hover
        const world = screenToWorld(e.clientX, e.clientY, transformRef.current, rect);
        const perspectiveRatio = SIMULATION.PERSPECTIVE_RATIO;
        const node = findNodeAtPoint(nodes, world.x, world.y, centerX, centerY);

        // Update ring hover state
        const hoveredRing = node ? null : findHoveredRing(world.x, world.y, perspectiveRatio);
        hoveredRingRef.current = hoveredRing;

        const prevNode = hoveredNodeRef.current;
        const nodeChanged = node?.id !== prevNode?.id;

        if (nodeChanged) {
          hoveredNodeRef.current = node;
          canvas.style.cursor = node ? "pointer" : "grab";

          // Notify about node hover change for rotation pause
          if (onNodeHoverChange) {
            onNodeHoverChange(node !== null);
          }

          if (onNodeHover) {
            if (node) {
              const pos = getNodePosition(node, centerX, centerY);
              const screen = worldToScreen(pos.x, pos.y, transformRef.current);
              onNodeHover(node, { x: screen.x + rect.left, y: screen.y + rect.top });
            } else {
              onNodeHover(null, { x: 0, y: 0 });
            }
          }
        }
      }
    },
    [nodes, width, height, onNodeHover, onNodeDrag, onNodeHoverChange]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const drag = dragRef.current;
      const centerX = width / 2;
      const centerY = height / 2;

      canvas.releasePointerCapture(e.pointerId);
      canvas.style.cursor = hoveredNodeRef.current ? "pointer" : "grab";

      if (drag.type === "node") {
        // If we didn't actually drag (no movement), treat as click if
        if (onNodeClick) {
          onNodeClick(drag.node, { x: e.clientX, y: e.clientY });
        }
        if (onNodeDragEnd) {
          onNodeDragEnd(drag.node.id);
        }
        dragRef.current = { type: "none" };
      } else if (drag.type === "pan") {
        if (
          Math.abs(e.clientX - drag.startX) < 5 &&
          Math.abs(e.clientY - drag.startY) < 5
        ) {
          const rect = canvas.getBoundingClientRect();
          const world = screenToWorld(e.clientX, e.clientY, transformRef.current, rect);
          const node = findNodeAtPoint(nodes, world.x, world.y, centerX, centerY);

          if (node && onNodeClick) {
            onNodeClick(node, { x: e.clientX, y: e.clientY });
          }
        }
        dragRef.current = { type: "none" };
      } else {
        const rect = canvas.getBoundingClientRect();
        const world = screenToWorld(e.clientX, e.clientY, transformRef.current, rect);
        const node = findNodeAtPoint(nodes, world.x, world.y, centerX, centerY);

        if (node && onNodeClick) {
          onNodeClick(node, { x: e.clientX, y: e.clientY });
        }
      }
    },
    [nodes, width, height, onNodeClick, onNodeDragEnd]
  );

  const handlePointerLeave = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = "grab";
    }

    hoveredRingRef.current = null;

    if (hoveredNodeRef.current) {
      hoveredNodeRef.current = null;
      if (onNodeHoverChange) {
        onNodeHoverChange(false);
      }
      if (onNodeHover) {
        onNodeHover(null, { x: 0, y: 0 });
      }
    }
  }, [onNodeHover, onNodeHoverChange]);

  const handleMouseEnter = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas && dragRef.current.type === "none") {
      canvas.style.cursor = "grab";
    }
    if (onHoverChange) {
      onHoverChange(true);
    }
  }, [onHoverChange]);

  const handleMouseLeave = useCallback(() => {
    hoveredRingRef.current = null;

    if (onHoverChange) {
      onHoverChange(false);
    }
    if (hoveredNodeRef.current) {
      hoveredNodeRef.current = null;
      if (onNodeHover) {
        onNodeHover(null, { x: 0, y: 0 });
      }
    }
  }, [onHoverChange, onNodeHover]);

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();

      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const transform = transformRef.current;
      const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newK = Math.min(
        INTERACTION.MAX_ZOOM,
        Math.max(INTERACTION.MIN_ZOOM, transform.k * scaleFactor)
      );

      const ratio = newK / transform.k;
      transformRef.current = {
        x: mouseX - (mouseX - transform.x) * ratio,
        y: mouseY - (mouseY - transform.y) * ratio,
        k: newK,
      };
    },
    []
  );

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className={className}
      style={{ width, height, cursor: "grab" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    />
  );
}
