"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import type { SimulatedNode, SimulatedLink, OrbitCanvasProps } from "./types";
import {
  RING_RADII,
  RING_LABELS,
  ANIMATION,
  INTERACTION,
  SIMULATION,
} from "./constants";
import type { OrbitLevel } from "./types";

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
  | { type: "pan"; startX: number; startY: number; startTransformX: number; startTransformY: number };

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
  rotationOffset: number,
  perspectiveRatio: number
): { x: number; y: number } {
  const radiusX = RING_RADII[node.orbitLevel];
  const radiusY = radiusX * perspectiveRatio;
  const angle = node.baseAngle + rotationOffset;
  return {
    x: Math.cos(angle) * radiusX,
    y: Math.sin(angle) * radiusY,
  };
}

function findNodeAtPoint(
  nodes: SimulatedNode[],
  x: number,
  y: number,
  rotationOffset: number,
  perspectiveRatio: number,
  hitRadiusMultiplier = 1.3
): SimulatedNode | null {
  // Search in reverse to find topmost node first
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const pos = getNodePosition(node, rotationOffset, perspectiveRatio);
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
    // Normalized ellipse equation: (x/a)^2 + (y/b)^2 = 1
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
  onHoverChange,
  className = "",
}: OrbitCanvasProps) {
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
  const rotationStartRef = useRef<number>(performance.now());
  const pausedAtRef = useRef<number | null>(null);
  const isPausedRef = useRef(false);
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store stable rotation offset for hit testing during pause
  const stableRotationOffsetRef = useRef<number>(0);

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
        setCenterLogoLoaded(true); // Still mark as "loaded" to show fallback
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
    ctx.scale(dpr, dpr);

    const transform = transformRef.current;
    const now = performance.now();
    const elapsed = now - animationStartRef.current;

    // Calculate animation progress
    const nodeProgress = Math.min(1, elapsed / ANIMATION.FADE_IN_DURATION);
    const bridgeElapsed = Math.max(0, elapsed - ANIMATION.BRIDGE_DELAY);
    const bridgeProgress = Math.min(1, bridgeElapsed / ANIMATION.BRIDGE_DURATION);

    // Calculate rotation offset (continuous rotation, pausable)
    let rotationOffset: number;
    if (isPausedRef.current && pausedAtRef.current !== null) {
      const rotationElapsed = (pausedAtRef.current - rotationStartRef.current) / 1000;
      rotationOffset = rotationElapsed * SIMULATION.ROTATION_SPEED;
    } else {
      const rotationElapsed = (now - rotationStartRef.current) / 1000;
      rotationOffset = rotationElapsed * SIMULATION.ROTATION_SPEED;
    }

    // Store stable rotation offset for hit testing
    stableRotationOffsetRef.current = rotationOffset;

    // Update ring label opacities (fade in/out)
    const hoveredRing = hoveredRingRef.current;
    const fadeSpeed = 0.1; // Opacity change per frame
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

    // Perspective ratio
    const perspectiveRatio = SIMULATION.PERSPECTIVE_RATIO;

    // Clear canvas (transparent background)
    ctx.clearRect(0, 0, width, height);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    const centerX = 0;
    const centerY = 0;

    // Draw orbit rings as ellipses for perspective effect
    orbitLevels.forEach((level) => {
      const radiusX = RING_RADII[level];
      const radiusY = radiusX * perspectiveRatio;

      ctx.beginPath();
      ctx.ellipse(centerX, centerY, radiusX, radiusY, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
      ctx.lineWidth = 1 / transform.k;
      ctx.stroke();

      // Draw ring label at the top of ellipse with fade opacity
      const labelOpacity = ringLabelOpacitiesRef.current[level];
      if (labelOpacity > 0.01) {
        const label = RING_LABELS[level];
        ctx.font = `${10 / transform.k}px system-ui, sans-serif`;
        ctx.fillStyle = `rgba(148, 163, 184, ${0.8 * labelOpacity})`;
        ctx.textAlign = "center";
        ctx.fillText(label, centerX, centerY - radiusY - 6 / transform.k);
      }
    });

    // Draw center logo/avatar as a planet circle (smaller)
    const centerLogoImg = centerLogoRef.current;
    const logoRadius = 32;
    const nameOffset = logoRadius + 14 / transform.k;

    if (centerLogoImg && centerLogoImg.complete && centerLogoImg.naturalWidth > 0) {
      // Draw image
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

      // Add subtle glow/border around the logo
      ctx.beginPath();
      ctx.arc(centerX, centerY, logoRadius, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 2 / transform.k;
      ctx.stroke();
    } else {
      // Draw fallback with users icon
      ctx.beginPath();
      ctx.arc(centerX, centerY, logoRadius, 0, Math.PI * 2);
      ctx.fillStyle = "#3b82f6"; // Brand blue
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = 2 / transform.k;
      ctx.stroke();

      // Draw users icon (multi-person icon)
      ctx.save();
      ctx.fillStyle = "white";
      const iconScale = logoRadius / 16;
      ctx.translate(centerX, centerY);
      ctx.scale(iconScale, iconScale);
      // Center person (head)
      ctx.beginPath();
      ctx.arc(0, -4, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // Center person (body)
      ctx.beginPath();
      ctx.ellipse(0, 6, 5.5, 4, 0, Math.PI, 0, true);
      ctx.fill();
      // Left person (smaller, behind)
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(-8, -2, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(-8, 6, 4, 3, 0, Math.PI, 0, true);
      ctx.fill();
      // Right person (smaller, behind)
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

        // Get rotated positions
        const sourcePos = getNodePosition(source, rotationOffset, perspectiveRatio);
        const targetPos = getNodePosition(target, rotationOffset, perspectiveRatio);

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

    // Draw nodes with animation
    const hoveredNode = hoveredNodeRef.current;
    nodes.forEach((node) => {
      // Get rotated position
      const pos = getNodePosition(node, rotationOffset, perspectiveRatio);
      const nx = pos.x;
      const ny = pos.y;

      const isHovered = hoveredNode?.id === node.id;
      const scale = isHovered ? INTERACTION.HOVER_SCALE : 1;
      const radius = node.radius * scale;
      const alpha = nodeProgress;

      ctx.globalAlpha = alpha;

      // Node background circle (gray like homepage)
      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);
      ctx.fillStyle = "#374151"; // Gray background
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
        // User icon path (simplified)
        ctx.beginPath();
        // Head circle
        ctx.arc(0, -3, 4, 0, Math.PI * 2);
        ctx.fill();
        // Body arc
        ctx.beginPath();
        ctx.ellipse(0, 8, 7, 5, 0, Math.PI, 0, true);
        ctx.fill();
        ctx.restore();
      }

      // Border (always visible, brighter on hover - like homepage)
      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, Math.PI * 2);
      ctx.strokeStyle = isHovered ? "rgba(255, 255, 255, 1)" : "rgba(255, 255, 255, 0.5)";
      ctx.lineWidth = (isHovered ? 3 : 1.5) / transform.k;
      ctx.stroke();

      ctx.globalAlpha = 1;
    });

    ctx.restore();

    // Always continue animation for rotation
    animationRef.current = requestAnimationFrame(render);
  }, [nodes, links, width, height, centerLogoUrl, centerLogoLoaded, centerName]);

  // Start continuous render loop
  useEffect(() => {
    animationRef.current = requestAnimationFrame(render);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
    };
  }, [render]);

  // Get current rotation offset for hit testing (use stable value during pause)
  const getCurrentRotationOffset = useCallback(() => {
    return stableRotationOffsetRef.current;
  }, []);

  // Pointer event handlers
  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const world = screenToWorld(e.clientX, e.clientY, transformRef.current, rect);
      const rotationOffset = getCurrentRotationOffset();
      const perspectiveRatio = SIMULATION.PERSPECTIVE_RATIO;
      const node = findNodeAtPoint(nodes, world.x, world.y, rotationOffset, perspectiveRatio);

      // Only start panning if not clicking on a node
      if (!node) {
        canvas.setPointerCapture(e.pointerId);
        dragRef.current = {
          type: "pan",
          startX: e.clientX,
          startY: e.clientY,
          startTransformX: transformRef.current.x,
          startTransformY: transformRef.current.y,
        };
        canvas.style.cursor = "grabbing";
      }
    },
    [nodes, getCurrentRotationOffset]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const drag = dragRef.current;

      if (drag.type === "pan") {
        // Panning - update transform
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
        const rotationOffset = getCurrentRotationOffset();
        const perspectiveRatio = SIMULATION.PERSPECTIVE_RATIO;
        const node = findNodeAtPoint(nodes, world.x, world.y, rotationOffset, perspectiveRatio);

        // Update ring hover state
        const hoveredRing = node ? null : findHoveredRing(world.x, world.y, perspectiveRatio);
        hoveredRingRef.current = hoveredRing;

        const prevNode = hoveredNodeRef.current;
        const wasHoveringNode = prevNode !== null;
        const isHoveringNode = node !== null;
        const nodeChanged = node !== prevNode;

        // Update hovered node reference
        if (nodeChanged) {
          hoveredNodeRef.current = node;
          canvas.style.cursor = node ? "pointer" : "grab";

          // Update tooltip
          if (onNodeHover) {
            if (node) {
              const pos = getNodePosition(node, rotationOffset, perspectiveRatio);
              const screen = worldToScreen(pos.x, pos.y, transformRef.current);
              onNodeHover(node, { x: screen.x + rect.left, y: screen.y + rect.top });
            } else {
              onNodeHover(null, { x: 0, y: 0 });
            }
          }
        }

        // Pause/unpause animation based on node hover
        if (isHoveringNode && !isPausedRef.current) {
          // Started hovering a node - cancel any pending resume and pause
          if (resumeTimeoutRef.current) {
            clearTimeout(resumeTimeoutRef.current);
            resumeTimeoutRef.current = null;
          }
          isPausedRef.current = true;
          pausedAtRef.current = performance.now();
        } else if (!isHoveringNode && wasHoveringNode && isPausedRef.current) {
          // Stopped hovering all nodes - schedule resume after delay
          if (resumeTimeoutRef.current) {
            clearTimeout(resumeTimeoutRef.current);
          }
          resumeTimeoutRef.current = setTimeout(() => {
            if (pausedAtRef.current !== null) {
              const pauseDuration = performance.now() - pausedAtRef.current;
              rotationStartRef.current += pauseDuration;
            }
            isPausedRef.current = false;
            pausedAtRef.current = null;
            resumeTimeoutRef.current = null;
          }, INTERACTION.RESUME_ROTATION_DELAY);
        }
      }
    },
    [nodes, onNodeHover, getCurrentRotationOffset]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const drag = dragRef.current;

      if (drag.type === "pan") {
        canvas.releasePointerCapture(e.pointerId);
      }
      canvas.style.cursor = hoveredNodeRef.current ? "pointer" : "grab";
      dragRef.current = { type: "none" };

      // Handle click (if wasn't dragging or was minimal movement)
      if (drag.type === "none" || (drag.type === "pan" &&
          Math.abs(e.clientX - drag.startX) < 5 &&
          Math.abs(e.clientY - drag.startY) < 5)) {
        const rect = canvas.getBoundingClientRect();
        const world = screenToWorld(e.clientX, e.clientY, transformRef.current, rect);
        const rotationOffset = getCurrentRotationOffset();
        const perspectiveRatio = SIMULATION.PERSPECTIVE_RATIO;
        const node = findNodeAtPoint(nodes, world.x, world.y, rotationOffset, perspectiveRatio);

        if (node && onNodeClick) {
          onNodeClick(node);
        }
      }
    },
    [nodes, onNodeClick, getCurrentRotationOffset]
  );

  const handlePointerLeave = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = "grab";
    }

    // Clear ring hover
    hoveredRingRef.current = null;

    if (hoveredNodeRef.current) {
      hoveredNodeRef.current = null;
      // Resume rotation after delay
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
      resumeTimeoutRef.current = setTimeout(() => {
        if (pausedAtRef.current !== null) {
          const pauseDuration = performance.now() - pausedAtRef.current;
          rotationStartRef.current += pauseDuration;
        }
        isPausedRef.current = false;
        pausedAtRef.current = null;
        resumeTimeoutRef.current = null;
      }, INTERACTION.RESUME_ROTATION_DELAY);
      if (onNodeHover) {
        onNodeHover(null, { x: 0, y: 0 });
      }
    }
  }, [onNodeHover]);

  // Handle mouse enter
  const handleMouseEnter = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas && dragRef.current.type === "none") {
      canvas.style.cursor = "grab";
    }
    if (onHoverChange) {
      onHoverChange(true);
    }
  }, [onHoverChange]);

  // Handle mouse leave - hide labels and resume animation after delay if paused
  const handleMouseLeave = useCallback(() => {
    // Clear ring hover
    hoveredRingRef.current = null;

    if (onHoverChange) {
      onHoverChange(false);
    }
    // Clear node hover and resume animation after delay if was paused
    if (hoveredNodeRef.current) {
      hoveredNodeRef.current = null;
      if (resumeTimeoutRef.current) {
        clearTimeout(resumeTimeoutRef.current);
      }
      resumeTimeoutRef.current = setTimeout(() => {
        if (pausedAtRef.current !== null) {
          const pauseDuration = performance.now() - pausedAtRef.current;
          rotationStartRef.current += pauseDuration;
        }
        isPausedRef.current = false;
        pausedAtRef.current = null;
        resumeTimeoutRef.current = null;
      }, INTERACTION.RESUME_ROTATION_DELAY);
      if (onNodeHover) {
        onNodeHover(null, { x: 0, y: 0 });
      }
    }
  }, [onHoverChange, onNodeHover]);

  // Wheel handler for zoom
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

      // Zoom toward mouse position
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
