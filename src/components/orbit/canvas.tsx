"use client";

import { useEffect, useRef, useCallback } from "react";

import { RING_RADII, PERSPECTIVE_RATIO, INTERACTION } from "./constants";
import type { SimulatedNode } from "./types";

/* ────────────────────────────
   Transform (zoom + pan)
──────────────────────────── */

interface Transform {
  x: number; // translation X (screen px)
  y: number; // translation Y (screen px)
  k: number; // scale factor (1 = 100%)
}

/** Convert screen coords → world coords (inverse transform) */
function screenToWorld(sx: number, sy: number, t: Transform) {
  return {
    x: (sx - t.x) / t.k,
    y: (sy - t.y) / t.k,
  };
}

/** Convert world coords → screen coords */
function worldToScreen(wx: number, wy: number, t: Transform) {
  return {
    x: wx * t.k + t.x,
    y: wy * t.k + t.y,
  };
}

/* ────────────────────────────
   Hit testing
──────────────────────────── */

function findNodeAtWorld(
  nodes: SimulatedNode[],
  wx: number,
  wy: number,
  simCx: number,
  simCy: number,
  hitMultiplier = 1.3,
): SimulatedNode | null {
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    const nx = (node.x ?? simCx) - simCx;
    const ny = (node.y ?? simCy) - simCy;
    const dx = wx - nx;
    const dy = wy - ny;
    const hr = node.radius * hitMultiplier;
    if (dx * dx + dy * dy <= hr * hr) return node;
  }
  return null;
}

/* ────────────────────────────
   Drag state
──────────────────────────── */

type DragState =
  | { type: "none" }
  | { type: "node"; nodeId: string; pointerId: number; didMove: boolean }
  | {
      type: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      startTx: number;
      startTy: number;
    };

/* ────────────────────────────
   Node avatar image cache
──────────────────────────── */

/** Lazily loads avatar images and caches them by URL */
class AvatarImageCache {
  private cache = new Map<string, HTMLImageElement | null>();
  private loading = new Set<string>();

  /** Returns loaded image, null (failed/missing), or undefined (still loading) */
  get(url: string | null): HTMLImageElement | null | undefined {
    if (!url) return null;
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached; // loaded or failed

    if (this.loading.has(url)) return undefined; // in-flight

    // Start loading — no crossOrigin needed since we only drawImage (no pixel reads)
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
   Component
──────────────────────────── */

const CENTER_LOGO_RADIUS = 32;

export interface OrbitCanvasProps {
  width: number;
  height: number;
  nodes: SimulatedNode[];
  centerLogoUrl?: string | null;
  centerName?: string;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string) => void;
  onNodeHover?: (node: SimulatedNode | null, screenPos: { x: number; y: number }) => void;
  onNodeClick?: (node: SimulatedNode, screenPos: { x: number; y: number }) => void;
}

export function OrbitCanvas({
  width,
  height,
  nodes,
  centerLogoUrl,
  centerName,
  onDrag,
  onDragEnd,
  onNodeHover,
  onNodeClick,
}: OrbitCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Mutable refs so the rAF loop reads fresh values
  const nodesRef = useRef(nodes);
  const sizeRef = useRef({ width, height });
  const centerNameRef = useRef(centerName);
  const centerLogoUrlRef = useRef(centerLogoUrl);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { sizeRef.current = { width, height }; }, [width, height]);
  useEffect(() => { centerNameRef.current = centerName; }, [centerName]);
  useEffect(() => { centerLogoUrlRef.current = centerLogoUrl; }, [centerLogoUrl]);

  // Single image cache for all avatars (nodes + center logo)
  const imageCacheRef = useRef(new AvatarImageCache());

  // Eagerly kick off center logo load
  if (centerLogoUrl) imageCacheRef.current.get(centerLogoUrl);

  // Transform: centered on canvas initially
  const transformRef = useRef<Transform>({ x: width / 2, y: height / 2, k: 1 });

  // Keep transform origin synced when container resizes
  useEffect(() => {
    const t = transformRef.current;
    if (t.k === 1) {
      t.x = width / 2;
      t.y = height / 2;
    }
  }, [width, height]);

  // Drag + pan state
  const dragRef = useRef<DragState>({ type: "none" });
  const onDragRef = useRef(onDrag);
  const onDragEndRef = useRef(onDragEnd);
  const onNodeHoverRef = useRef(onNodeHover);
  const onNodeClickRef = useRef(onNodeClick);
  const hoveredNodeIdRef = useRef<string | null>(null);

  useEffect(() => { onDragRef.current = onDrag; }, [onDrag]);
  useEffect(() => { onDragEndRef.current = onDragEnd; }, [onDragEnd]);
  useEffect(() => { onNodeHoverRef.current = onNodeHover; }, [onNodeHover]);
  useEffect(() => { onNodeClickRef.current = onNodeClick; }, [onNodeClick]);

  /* ────────────────────────────
     Render loop
  ──────────────────────────── */

  useEffect(() => {
    let running = true;

    function frame() {
      if (!running) return;

      const { width: w, height: h } = sizeRef.current;
      const ctx = canvasRef.current?.getContext("2d");

      if (!ctx || w === 0 || h === 0) {
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      const transform = transformRef.current;
      const hoveredId = hoveredNodeIdRef.current;

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      // Draw orbit ring ellipses
      const ringLevels: Array<keyof typeof RING_RADII> = ["ADVOCATE", "CONTRIBUTOR", "PARTICIPANT", "EXPLORER"];
      for (const level of ringLevels) {
        const rx = RING_RADII[level];
        const ry = rx * PERSPECTIVE_RATIO;
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
        ctx.lineWidth = 1 / transform.k;
        ctx.stroke();
      }

      // Draw center logo
      const imageCache = imageCacheRef.current;
      const logoUrl = centerLogoUrlRef.current;
      const logoImg = logoUrl ? imageCache.get(logoUrl) : null;
      const r = CENTER_LOGO_RADIUS;

      if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
        // Clip to circle and draw image
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logoImg, -r, -r, r * 2, r * 2);
        ctx.restore();

        // Border
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 2 / transform.k;
        ctx.stroke();
      } else {
        // Fallback: blue circle
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = "#3b82f6";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
        ctx.lineWidth = 2 / transform.k;
        ctx.stroke();
      }

      // Community name below logo
      const name = centerNameRef.current;
      if (name) {
        ctx.font = `500 ${12 / transform.k}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(name, 0, r + 14 / transform.k);
      }

      // Draw nodes
      const currentNodes = nodesRef.current;
      const { width: cw, height: ch } = sizeRef.current;
      const simCx = cw / 2;
      const simCy = ch / 2;
      for (const node of currentNodes) {
        const nx = (node.x ?? simCx) - simCx;
        const ny = (node.y ?? simCy) - simCy;
        const isHovered = node.id === hoveredId;
        const nr = node.radius;

        // Background fill (always draw as base / fallback bg)
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();

        // Avatar image (if available)
        const avatarImg = imageCache.get(node.avatarUrl);
        if (avatarImg && avatarImg.complete && avatarImg.naturalWidth > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(nx, ny, nr, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(avatarImg, nx - nr, ny - nr, nr * 2, nr * 2);
          ctx.restore();
        }

        // Border — brighter on hover
        ctx.beginPath();
        ctx.arc(nx, ny, nr, 0, Math.PI * 2);
        ctx.strokeStyle = isHovered
          ? "rgba(255, 255, 255, 1)"
          : "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = (isHovered ? 3 : 1.5) / transform.k;
        ctx.stroke();
      }

      ctx.restore();
      rafRef.current = requestAnimationFrame(frame);
    }

    rafRef.current = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  /* ────────────────────────────
     Wheel → zoom to cursor
  ──────────────────────────── */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleWheel(e: WheelEvent) {
      e.preventDefault();

      const rect = canvas!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const t = transformRef.current;
      const scaleFactor = e.deltaY < 0 ? 1.1 : 0.9;
      const newK = Math.min(
        INTERACTION.MAX_ZOOM,
        Math.max(INTERACTION.MIN_ZOOM, t.k * scaleFactor),
      );

      const ratio = newK / t.k;
      transformRef.current = {
        x: mouseX - (mouseX - t.x) * ratio,
        y: mouseY - (mouseY - t.y) * ratio,
        k: newK,
      };
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  /* ────────────────────────────
     Pointer events
  ──────────────────────────── */

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const world = screenToWorld(screenX, screenY, transformRef.current);
    const { width: cw, height: ch } = sizeRef.current;
    const simCx = cw / 2;
    const simCy = ch / 2;

    const hitNode = findNodeAtWorld(nodesRef.current, world.x, world.y, simCx, simCy);

    if (hitNode) {
      canvas.setPointerCapture(e.pointerId);
      dragRef.current = { type: "node", nodeId: hitNode.id, pointerId: e.pointerId, didMove: false };
      onDragRef.current(hitNode.id, world.x + simCx, world.y + simCy);
      return;
    }

    // No node hit → pan
    canvas.setPointerCapture(e.pointerId);
    const t = transformRef.current;
    dragRef.current = {
      type: "pan",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTx: t.x,
      startTy: t.y,
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;

    if (drag.type === "node") {
      drag.didMove = true;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(screenX, screenY, transformRef.current);
      const { width: cw, height: ch } = sizeRef.current;
      onDragRef.current(drag.nodeId, world.x + cw / 2, world.y + ch / 2);
      return;
    }

    if (drag.type === "pan") {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      transformRef.current = {
        ...transformRef.current,
        x: drag.startTx + dx,
        y: drag.startTy + dy,
      };
      return;
    }

    // Not dragging → hover detection
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY, transformRef.current);
    const { width: cw, height: ch } = sizeRef.current;
    const simCx = cw / 2;
    const simCy = ch / 2;

    const hitNode = findNodeAtWorld(nodesRef.current, world.x, world.y, simCx, simCy);
    const prevId = hoveredNodeIdRef.current;
    const newId = hitNode?.id ?? null;

    if (newId !== prevId) {
      hoveredNodeIdRef.current = newId;
      canvas.style.cursor = hitNode ? "pointer" : "grab";

      if (onNodeHoverRef.current) {
        if (hitNode) {
          const nx = (hitNode.x ?? simCx) - simCx;
          const ny = (hitNode.y ?? simCy) - simCy;
          const screen = worldToScreen(nx, ny, transformRef.current);
          onNodeHoverRef.current(hitNode, { x: screen.x + rect.left, y: screen.y + rect.top });
        } else {
          onNodeHoverRef.current(null, { x: 0, y: 0 });
        }
      }
    }
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.type === "none") return;

    const canvas = canvasRef.current;
    if (canvas) {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    if (drag.type === "node") {
      onDragEndRef.current(drag.nodeId);

      // Click = pointerDown on node + pointerUp without significant move
      if (!drag.didMove && onNodeClickRef.current) {
        const node = nodesRef.current.find((n) => n.id === drag.nodeId);
        if (node && canvas) {
          const rect = canvas.getBoundingClientRect();
          const { width: cw, height: ch } = sizeRef.current;
          const simCx = cw / 2;
          const simCy = ch / 2;
          const nx = (node.x ?? simCx) - simCx;
          const ny = (node.y ?? simCy) - simCy;
          const screen = worldToScreen(nx, ny, transformRef.current);
          onNodeClickRef.current(node, { x: screen.x + rect.left, y: screen.y + rect.top });
        }
      }
    }

    dragRef.current = { type: "none" };
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (hoveredNodeIdRef.current) {
      hoveredNodeIdRef.current = null;
      onNodeHoverRef.current?.(null, { x: 0, y: 0 });
    }
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width, height, cursor: "grab" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerLeave}
    />
  );
}
