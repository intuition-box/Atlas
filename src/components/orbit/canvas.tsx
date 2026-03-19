"use client";

import { useEffect, useRef, useCallback } from "react";

import { RING_RADII, PERSPECTIVE_RATIO, INTERACTION } from "./constants";
import type { SimulatedNode } from "./types";

const RING_LEVELS: Array<keyof typeof RING_RADII> = [
  "ADVOCATE",
  "CONTRIBUTOR",
  "PARTICIPANT",
  "EXPLORER",
];

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

function isCenterHit(wx: number, wy: number, hitMultiplier = 1.3): boolean {
  const hitRadius = CENTER_LOGO_RADIUS * hitMultiplier;
  return wx * wx + wy * wy <= hitRadius * hitRadius;
}

/* ────────────────────────────
   Drag state
──────────────────────────── */

type DragState =
  | { type: "none" }
  | { type: "node"; nodeId: string; pointerId: number; didMove: boolean; startX: number; startY: number }
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
  /** Callback invoked when any image finishes loading (success or failure) */
  onLoad: (() => void) | null = null;

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
   Component
──────────────────────────── */

const CENTER_LOGO_RADIUS = 32;

/** Screen position for tooltip/popover anchoring */
type ScreenPos = { x: number; y: number; screenRadius: number };

export interface OrbitCanvasProps {
  width: number;
  height: number;
  nodes: SimulatedNode[];
  centerLogoUrl?: string | null;
  centerName?: string;
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string) => void;
  /** Called when a node drag begins (before onDrag). Use to clear tooltips. */
  onDragStart?: () => void;
  onNodeHover?: (node: SimulatedNode | null, screenPos: ScreenPos) => void;
  onNodeClick?: (node: SimulatedNode, screenPos: ScreenPos) => void;
  /** Called when the center logo/avatar hover state changes */
  onCenterHover?: (hovered: boolean, screenPos: ScreenPos) => void;
  /** Called when the center logo/avatar area is clicked */
  onCenterClick?: (screenPos: ScreenPos) => void;
}

export function OrbitCanvas({
  width,
  height,
  nodes,
  centerLogoUrl,
  centerName,
  onDrag,
  onDragEnd,
  onDragStart,
  onNodeHover,
  onNodeClick,
  onCenterHover,
  onCenterClick,
}: OrbitCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Offscreen canvas for static geometry (rings only — center avatar drawn per-frame for hover state)
  const staticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Flag to invalidate and rebuild the static layer
  const staticDirtyRef = useRef(true);

  // Mutable refs so the rAF loop reads fresh values
  const nodesRef = useRef(nodes);
  const sizeRef = useRef({ width, height });
  const centerNameRef = useRef(centerName);
  const centerLogoUrlRef = useRef(centerLogoUrl);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => {
    sizeRef.current = { width, height };
    staticDirtyRef.current = true;
  }, [width, height]);
  useEffect(() => { centerNameRef.current = centerName; }, [centerName]);
  useEffect(() => { centerLogoUrlRef.current = centerLogoUrl; }, [centerLogoUrl]);

  // Single image cache for all avatars (nodes + center logo)
  const imageCacheRef = useRef(new AvatarImageCache());

  // Eagerly kick off center logo load
  if (centerLogoUrl) imageCacheRef.current.get(centerLogoUrl);

  // World → screen transform (camera state).
  // Mutated imperatively to avoid React re-renders during interaction.
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
  const onCenterHoverRef = useRef(onCenterHover);
  const onDragStartRef = useRef(onDragStart);
  const onCenterClickRef = useRef(onCenterClick);
  const hoveredNodeIdRef = useRef<string | null>(null);
  const hoveredCenterRef = useRef(false);

  useEffect(() => { onDragRef.current = onDrag; }, [onDrag]);
  useEffect(() => { onDragEndRef.current = onDragEnd; }, [onDragEnd]);
  useEffect(() => { onNodeHoverRef.current = onNodeHover; }, [onNodeHover]);
  useEffect(() => { onNodeClickRef.current = onNodeClick; }, [onNodeClick]);
  useEffect(() => { onCenterHoverRef.current = onCenterHover; }, [onCenterHover]);
  useEffect(() => { onDragStartRef.current = onDragStart; }, [onDragStart]);
  useEffect(() => { onCenterClickRef.current = onCenterClick; }, [onCenterClick]);

  /* ────────────────────────────
     Render loop

     Draws every frame unconditionally so the canvas stays
     in sync with the D3 simulation which mutates node.x/y
     in-place (including orbital rotation).

     Static geometry (rings) is cached in an offscreen canvas.
     Center avatar is drawn per-frame because its border
     changes with hover state.
  ──────────────────────────── */

  useEffect(() => {
    let running = true;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    // Configure canvas for HiDPI once
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Rebuild static layer when images load (e.g. center logo)
    imageCacheRef.current.onLoad = () => {
      staticDirtyRef.current = true;
    };

    function rebuildStaticLayer(
      w: number,
      h: number,
      transform: Transform,
    ) {
      const staticCanvas = document.createElement("canvas");
      staticCanvas.width = Math.round(w * dpr);
      staticCanvas.height = Math.round(h * dpr);

      const sctx = staticCanvas.getContext("2d");
      if (!sctx) return;

      sctx.scale(dpr, dpr);
      sctx.clearRect(0, 0, w, h);
      sctx.save();
      sctx.translate(transform.x, transform.y);
      sctx.scale(transform.k, transform.k);

      // Rings only — center avatar drawn per-frame
      for (const level of RING_LEVELS) {
        const rx = RING_RADII[level];
        const ry = rx * PERSPECTIVE_RATIO;
        sctx.beginPath();
        sctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        sctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
        sctx.lineWidth = 1 / transform.k;
        sctx.stroke();
      }

      sctx.restore();
      staticCanvasRef.current = staticCanvas;
      staticDirtyRef.current = false;
    }

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
      const isAvatarHovered = hoveredCenterRef.current;

      // Rebuild static layer when dirty (size/transform change)
      if (staticDirtyRef.current || !staticCanvasRef.current) {
        rebuildStaticLayer(w, h, transform);
      }

      // Clear + draw static layer (rings)
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, Math.round(w * dpr), Math.round(h * dpr));
      const staticCanvas = staticCanvasRef.current;
      if (staticCanvas) {
        ctx.drawImage(staticCanvas, 0, 0);
      }
      ctx.restore();

      // Draw dynamic elements in world space
      ctx.save();
      ctx.translate(transform.x, transform.y);
      ctx.scale(transform.k, transform.k);

      // ── Center avatar (drawn per-frame for hover border) ──
      const imageCache = imageCacheRef.current;
      const logoUrl = centerLogoUrlRef.current;
      const logoImg = logoUrl ? imageCache.get(logoUrl) : null;
      const r = CENTER_LOGO_RADIUS;

      if (logoImg && logoImg.complete && logoImg.naturalWidth > 0) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(logoImg, -r, -r, r * 2, r * 2);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = "#3b82f6";
        ctx.fill();
      }

      // Center border — brighter + thicker on hover (matches scene.tsx)
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.strokeStyle = isAvatarHovered
        ? "rgba(255, 255, 255, 1)"
        : "rgba(255, 255, 255, 0.3)";
      ctx.lineWidth = (isAvatarHovered ? 3 : 2) / transform.k;
      ctx.stroke();

      // Center name below logo
      const name = centerNameRef.current;
      if (name) {
        ctx.font = `500 ${12 / transform.k}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(name, 0, r + 14 / transform.k);
      }

      // ── Member nodes ──
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
        const avatarImg = imageCache.get(node.avatarUrl ?? null);
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
      imageCacheRef.current.onLoad = null;
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
      // Gentle exponential zoom for smoother trackpad / wheel behavior
      const zoomIntensity = 0.0015;
      const scaleFactor = Math.exp(-e.deltaY * zoomIntensity);
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
      staticDirtyRef.current = true;
    }

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  /* ────────────────────────────
     Helper: compute center screen position
  ──────────────────────────── */

  function getCenterScreenPos(rect: DOMRect): ScreenPos {
    const t = transformRef.current;
    return {
      x: t.x + rect.left,
      y: t.y + rect.top,
      screenRadius: CENTER_LOGO_RADIUS * t.k + 1.5,
    };
  }

  /* ────────────────────────────
     Pointer events
  ──────────────────────────── */

  /* Track whether the current pointer sequence involved actual movement.
     Click detection lives in the native `click` handler — NOT in pointerup —
     because Android Chrome can suppress pointerup for quick taps when
     setPointerCapture was called in pointerdown. The `click` event fires
     reliably on every platform regardless. */
  const wasDragRef = useRef(false);

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

    wasDragRef.current = false;

    // Larger hit area for touch inputs (finger vs cursor)
    const hitMult = e.pointerType === "touch" ? 1.6 : 1.3;
    const hitNode = findNodeAtWorld(nodesRef.current, world.x, world.y, simCx, simCy, hitMult);

    if (hitNode) {
      // Do NOT setPointerCapture here — it can suppress pointerup on Android
      // quick taps. Capture is deferred to handlePointerMove when drag starts.
      dragRef.current = { type: "node", nodeId: hitNode.id, pointerId: e.pointerId, didMove: false, startX: e.clientX, startY: e.clientY };
      // Clear tooltips on drag start (matches scene.tsx line 1586-1587)
      onDragStartRef.current?.();
      onDragRef.current(hitNode.id, world.x + simCx, world.y + simCy);
      return;
    }

    // No node hit → pan (also defer capture)
    onDragStartRef.current?.();
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
      // Only flag as moved after exceeding a threshold — touch jitter on
      // Android fires pointermove even when the finger is stationary
      if (!drag.didMove) {
        const jx = e.clientX - drag.startX;
        const jy = e.clientY - drag.startY;
        if (jx * jx + jy * jy < 64) return; // < 8px — ignore jitter
        drag.didMove = true;
        wasDragRef.current = true;
        // Now that actual drag started, capture the pointer
        const canvas = canvasRef.current;
        if (canvas) {
          try { canvas.setPointerCapture(drag.pointerId); } catch { /* ignore */ }
        }
      }
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
      // Ignore jitter for pan too
      if (!wasDragRef.current && dx * dx + dy * dy >= 64) {
        wasDragRef.current = true;
        const canvas = canvasRef.current;
        if (canvas) {
          try { canvas.setPointerCapture(drag.pointerId); } catch { /* ignore */ }
        }
      }
      if (wasDragRef.current) {
        transformRef.current = {
          ...transformRef.current,
          x: drag.startTx + dx,
          y: drag.startTy + dy,
        };
        staticDirtyRef.current = true;
      }
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

    // 1. Check member node hover
    const hitNode = findNodeAtWorld(nodesRef.current, world.x, world.y, simCx, simCy);
    const prevId = hoveredNodeIdRef.current;
    const newId = hitNode?.id ?? null;

    if (newId !== prevId) {
      hoveredNodeIdRef.current = newId;

      if (onNodeHoverRef.current) {
        if (hitNode) {
          const nx = (hitNode.x ?? simCx) - simCx;
          const ny = (hitNode.y ?? simCy) - simCy;
          const screen = worldToScreen(nx, ny, transformRef.current);
          onNodeHoverRef.current(hitNode, { x: screen.x + rect.left, y: screen.y + rect.top, screenRadius: hitNode.radius * transformRef.current.k + 1.5 });
        } else {
          onNodeHoverRef.current(null, { x: 0, y: 0, screenRadius: 0 });
        }
      }
    }

    // 2. Check center avatar hover (independent of node hover, matches scene.tsx)
    if (!hitNode) {
      const overCenter = isCenterHit(world.x, world.y);
      const wasHovered = hoveredCenterRef.current;

      if (overCenter !== wasHovered) {
        hoveredCenterRef.current = overCenter;
        if (onCenterHoverRef.current) {
          onCenterHoverRef.current(overCenter, getCenterScreenPos(rect));
        }
      }
    } else if (hoveredCenterRef.current) {
      // Node takes priority — clear center hover
      hoveredCenterRef.current = false;
      if (onCenterHoverRef.current) {
        onCenterHoverRef.current(false, getCenterScreenPos(rect));
      }
    }
  }, []);

  /** Clean up drag state — shared by pointerup and pointercancel.
   *  Click detection is NOT here; it lives in handleClick. */
  const finishPointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (drag.type === "none") return;

    const canvas = canvasRef.current;
    if (canvas) {
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    }

    if (drag.type === "node") {
      onDragEndRef.current(drag.nodeId);
    }

    dragRef.current = { type: "none" };
  }, []);

  const handlePointerUp = finishPointer;
  const handlePointerCancel = finishPointer;

  /** Native click event — fires reliably on all platforms (including Android
   *  quick taps where pointerup may be suppressed by setPointerCapture). */
  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (wasDragRef.current) return;

    // Clean up any lingering drag state (pointerup may not have fired)
    const drag = dragRef.current;
    if (drag.type === "node") {
      onDragEndRef.current(drag.nodeId);
    }
    dragRef.current = { type: "none" };

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY, transformRef.current);
    const { width: cw, height: ch } = sizeRef.current;
    const simCx = cw / 2;
    const simCy = ch / 2;

    // Check member node hit (use generous touch-size multiplier)
    const hitNode = findNodeAtWorld(nodesRef.current, world.x, world.y, simCx, simCy, 1.6);
    if (hitNode && onNodeClickRef.current) {
      const nx = (hitNode.x ?? simCx) - simCx;
      const ny = (hitNode.y ?? simCy) - simCy;
      const screen = worldToScreen(nx, ny, transformRef.current);
      onNodeClickRef.current(hitNode, { x: screen.x + rect.left, y: screen.y + rect.top, screenRadius: hitNode.radius * transformRef.current.k + 1.5 });
      return;
    }

    // Check center avatar hit
    if (isCenterHit(world.x, world.y) && onCenterClickRef.current) {
      onCenterClickRef.current(getCenterScreenPos(rect));
    }
  }, []);

  const handlePointerLeave = useCallback(() => {
    if (hoveredNodeIdRef.current) {
      hoveredNodeIdRef.current = null;
      onNodeHoverRef.current?.(null, { x: 0, y: 0, screenRadius: 0 });
    }
    if (hoveredCenterRef.current) {
      hoveredCenterRef.current = false;
      onCenterHoverRef.current?.(false, { x: 0, y: 0, screenRadius: 0 });
    }
  }, []);

  // Compute DPR-scaled canvas dimensions
  const dpr = typeof window !== "undefined"
    ? Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    : 1;

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(width * dpr)}
      height={Math.round(height * dpr)}
      style={{ display: "block", width, height, touchAction: "none" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      onClick={handleClick}
    />
  );
}
