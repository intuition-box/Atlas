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

/* ────────────────────────────
   Drag state
──────────────────────────── */

type DragState =
  | { type: "none" }
  | { type: "node"; nodeId: string; pointerId: number }
  | {
      type: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      startTx: number;
      startTy: number;
    };

/* ────────────────────────────
   Component
──────────────────────────── */

export function OrbitCanvas({
  width,
  height,
  nodes,
  onDrag,
  onDragEnd,
}: {
  width: number;
  height: number;
  nodes: SimulatedNode[];
  onDrag: (id: string, x: number, y: number) => void;
  onDragEnd: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);

  // Mutable refs so the rAF loop reads fresh values
  const nodesRef = useRef(nodes);
  const sizeRef = useRef({ width, height });

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);
  useEffect(() => { sizeRef.current = { width, height }; }, [width, height]);

  // Transform: centered on canvas initially
  const transformRef = useRef<Transform>({ x: width / 2, y: height / 2, k: 1 });

  // Keep transform origin synced when container resizes
  useEffect(() => {
    const t = transformRef.current;
    // Only update if this is the initial default (user hasn't panned/zoomed)
    if (t.k === 1) {
      t.x = width / 2;
      t.y = height / 2;
    }
  }, [width, height]);

  // Drag + pan state
  const dragRef = useRef<DragState>({ type: "none" });
  const onDragRef = useRef(onDrag);
  const onDragEndRef = useRef(onDragEnd);
  useEffect(() => { onDragRef.current = onDrag; }, [onDrag]);
  useEffect(() => { onDragEndRef.current = onDragEnd; }, [onDragEnd]);

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

      // Draw nodes at their simulation positions
      // Simulation coords are world-space (centered on 0,0 = center of orbits)
      // But simulation uses centerX/centerY as origin, so we need to offset
      const currentNodes = nodesRef.current;
      const { width: cw, height: ch } = sizeRef.current;
      const simCx = cw / 2;
      const simCy = ch / 2;

      for (const node of currentNodes) {
        // Convert simulation coords (centered on simCx, simCy) to world coords (centered on 0,0)
        const nx = (node.x ?? simCx) - simCx;
        const ny = (node.y ?? simCy) - simCy;

        // Fill
        ctx.beginPath();
        ctx.arc(nx, ny, node.radius, 0, Math.PI * 2);
        ctx.fillStyle = node.color;
        ctx.fill();

        // Border
        ctx.beginPath();
        ctx.arc(nx, ny, node.radius, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.5)";
        ctx.lineWidth = 1.5 / transform.k;
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

    // Must use { passive: false } to prevent default scroll
    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", handleWheel);
  }, []);

  /* ────────────────────────────
     Pointer events — drag nodes + pan
  ──────────────────────────── */

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Convert to world coords for hit testing
    const world = screenToWorld(screenX, screenY, transformRef.current);
    const { width: cw, height: ch } = sizeRef.current;
    const simCx = cw / 2;
    const simCy = ch / 2;

    // Hit test nodes (reverse order = top-most first)
    const currentNodes = nodesRef.current;
    for (let i = currentNodes.length - 1; i >= 0; i--) {
      const node = currentNodes[i];
      // Node position in world space (relative to orbit center)
      const nx = (node.x ?? simCx) - simCx;
      const ny = (node.y ?? simCy) - simCy;
      const dx = world.x - nx;
      const dy = world.y - ny;
      const hitRadius = node.radius * 1.5; // generous hit area

      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        canvas.setPointerCapture(e.pointerId);
        dragRef.current = { type: "node", nodeId: node.id, pointerId: e.pointerId };
        // Convert world position back to simulation coords for the drag callback
        onDragRef.current(node.id, world.x + simCx, world.y + simCy);
        return;
      }
    }

    // No node hit → start panning
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
    if (drag.type === "none") return;

    if (drag.type === "node") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const screenX = e.clientX - rect.left;
      const screenY = e.clientY - rect.top;
      const world = screenToWorld(screenX, screenY, transformRef.current);
      const { width: cw, height: ch } = sizeRef.current;
      onDragRef.current(drag.nodeId, world.x + cw / 2, world.y + ch / 2);
    } else if (drag.type === "pan") {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      transformRef.current = {
        ...transformRef.current,
        x: drag.startTx + dx,
        y: drag.startTy + dy,
      };
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
    }

    dragRef.current = { type: "none" };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{ width, height, cursor: dragRef.current.type === "pan" ? "grabbing" : "grab" }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}
