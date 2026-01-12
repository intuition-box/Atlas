"use client";

import * as React from "react";

export type OrbitUniverseCommunity = {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string | null;
  icon?: string | null;
};

type OrbitUniverseProps = {
  communities: OrbitUniverseCommunity[];

  /** Optional: control navigation without hard-coding routing conventions in this component. */
  hrefFor?: (c: OrbitUniverseCommunity) => string;
  onSelect?: (c: OrbitUniverseCommunity) => void;

  /** Optional UI */
  className?: string;
  style?: React.CSSProperties;

  /** Visual density */
  take?: number;
};

type Point = { x: number; y: number };

type Node = {
  id: string;
  handle: string;
  name: string;
  avatarUrl?: string | null;
  icon?: string | null;
  pos: Point; // world-space
};

function hashStringToU32(s: string): number {
  // FNV-1a (32-bit)
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function fitViewToBounds(args: {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  width: number;
  height: number;
  paddingPx?: number;
}): { offsetX: number; offsetY: number; scale: number } {
  const pad = args.paddingPx ?? 48;
  const w = Math.max(1, args.width - pad * 2);
  const h = Math.max(1, args.height - pad * 2);

  const bw = Math.max(1, args.bounds.maxX - args.bounds.minX);
  const bh = Math.max(1, args.bounds.maxY - args.bounds.minY);

  const scale = Math.min(w / bw, h / bh);
  const cx = (args.bounds.minX + args.bounds.maxX) / 2;
  const cy = (args.bounds.minY + args.bounds.maxY) / 2;

  // We draw with: screen = (world * scale) + offset
  // Want world center mapped to screen center.
  const offsetX = args.width / 2 - cx * scale;
  const offsetY = args.height / 2 - cy * scale;

  return { offsetX, offsetY, scale };
}

function computeBounds(nodes: Node[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const n of nodes) {
    minX = Math.min(minX, n.pos.x);
    minY = Math.min(minY, n.pos.y);
    maxX = Math.max(maxX, n.pos.x);
    maxY = Math.max(maxY, n.pos.y);
  }

  if (!Number.isFinite(minX)) {
    return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  }

  return { minX, minY, maxX, maxY };
}

function layoutGalaxy(communities: OrbitUniverseCommunity[]): Node[] {
  // Stable positions from ids (no timestamps, no randomness across reloads).
  const n = communities.length;
  const spread = Math.max(900, Math.sqrt(Math.max(1, n)) * 260);

  const nodes: Node[] = communities.map((c) => {
    const rnd = mulberry32(hashStringToU32(c.id));
    // Random in a disk (galaxy-ish), biased towards center.
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.62) * spread;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r * 0.68; // mild ellipse

    return {
      id: c.id,
      handle: c.handle,
      name: c.name,
      avatarUrl: c.avatarUrl ?? null,
      icon: c.icon ?? null,
      pos: { x, y },
    };
  });

  // Cheap relaxation so nodes don’t overlap too much.
  // Keep it light: a few iterations, small repulsion.
  const minSep = 54;
  const minSep2 = minSep * minSep;

  for (let iter = 0; iter < 5; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const d2 = dist2(a.pos, b.pos);
        if (d2 >= minSep2) continue;

        const d = Math.sqrt(Math.max(1e-6, d2));
        const push = (minSep - d) * 0.5;
        const ux = (a.pos.x - b.pos.x) / d;
        const uy = (a.pos.y - b.pos.y) / d;

        a.pos.x += ux * push;
        a.pos.y += uy * push;
        b.pos.x -= ux * push;
        b.pos.y -= uy * push;
      }
    }
  }

  return nodes;
}

export default function OrbitUniverse(props: OrbitUniverseProps) {
  const {
    communities,
    hrefFor,
    onSelect,
    className,
    style,
    take,
  } = props;

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);

  const nodes = React.useMemo(() => {
    const list = typeof take === "number" ? communities.slice(0, Math.max(0, take)) : communities;
    return layoutGalaxy(list);
  }, [communities, take]);

  const viewRef = React.useRef({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  });

  const sizeRef = React.useRef({ width: 1, height: 1, dpr: 1 });
  const rafRef = React.useRef<number | null>(null);

  const draggingRef = React.useRef<null | {
    startX: number;
    startY: number;
    startOffsetX: number;
    startOffsetY: number;
  }>(null);

  const pointerRef = React.useRef<{ x: number; y: number; inside: boolean }>({ x: 0, y: 0, inside: false });
  const hoveredIdRef = React.useRef<string | null>(null);

  const [tooltip, setTooltip] = React.useState<null | {
    id: string;
    name: string;
    handle: string;
    x: number;
    y: number;
  }>(null);

  const resolveHref = React.useCallback(
    (c: OrbitUniverseCommunity) => (hrefFor ? hrefFor(c) : `/c/${c.handle}`),
    [hrefFor],
  );

  const selectCommunity = React.useCallback(
    (c: OrbitUniverseCommunity) => {
      if (onSelect) {
        onSelect(c);
        return;
      }
      const href = resolveHref(c);
      // Keep it generic: navigation is handled by the browser.
      window.location.assign(href);
    },
    [onSelect, resolveHref],
  );

  const screenToWorld = React.useCallback((sx: number, sy: number): Point => {
    const v = viewRef.current;
    return {
      x: (sx - v.offsetX) / v.scale,
      y: (sy - v.offsetY) / v.scale,
    };
  }, []);

  const worldToScreen = React.useCallback((wx: number, wy: number): Point => {
    const v = viewRef.current;
    return {
      x: wx * v.scale + v.offsetX,
      y: wy * v.scale + v.offsetY,
    };
  }, []);

  const pickNode = React.useCallback(
    (sx: number, sy: number): Node | null => {
      const w = screenToWorld(sx, sy);

      // Hit radius in world-space (constant-ish in screen space).
      const hitPx = 20;
      const hitW = hitPx / viewRef.current.scale;
      const hitW2 = hitW * hitW;

      let best: Node | null = null;
      let bestD2 = Infinity;

      for (const n of nodes) {
        const d2 = dist2(n.pos, w);
        if (d2 > hitW2) continue;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = n;
        }
      }

      return best;
    },
    [nodes, screenToWorld],
  );

  const draw = React.useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const { width, height } = sizeRef.current;
      ctx.clearRect(0, 0, width, height);

      // Draw nodes
      for (const n of nodes) {
        const p = worldToScreen(n.pos.x, n.pos.y);

        // Skip offscreen (small margin)
        if (p.x < -80 || p.x > width + 80 || p.y < -80 || p.y > height + 80) continue;

        const isHover = hoveredIdRef.current === n.id;
        const r = isHover ? 10 : 7;

        // Keep colors neutral; globals/theme can override later.
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fill();

        ctx.lineWidth = 1;
        ctx.strokeStyle = isHover ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.35)";
        ctx.stroke();
      }
    },
    [nodes, worldToScreen],
  );

  const frame = React.useCallback(
    (_t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Hover detection (doesn’t pause time; no jump behavior here)
      const ptr = pointerRef.current;
      if (ptr.inside && !draggingRef.current) {
        const picked = pickNode(ptr.x, ptr.y);
        const next = picked?.id ?? null;
        if (hoveredIdRef.current !== next) {
          hoveredIdRef.current = next;
          if (picked) {
            setTooltip({
              id: picked.id,
              name: picked.name,
              handle: picked.handle,
              x: ptr.x,
              y: ptr.y,
            });
          } else {
            setTooltip(null);
          }
        } else if (tooltip && picked) {
          // keep tooltip tracking pointer
          setTooltip((prev) => (prev ? { ...prev, x: ptr.x, y: ptr.y } : prev));
        }
      } else if (hoveredIdRef.current) {
        hoveredIdRef.current = null;
        setTooltip(null);
      }

      draw(ctx);
      rafRef.current = window.requestAnimationFrame(frame);
    },
    [draw, pickNode, tooltip],
  );

  // Resize handling
  React.useEffect(() => {
    const el = containerRef.current;
    const canvas = canvasRef.current;
    if (!el || !canvas) return;

    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;

      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
      const width = Math.max(1, Math.floor(box.width));
      const height = Math.max(1, Math.floor(box.height));

      sizeRef.current = { width, height, dpr };

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }

      // Fit view on first resize / when nodes change.
      const bounds = computeBounds(nodes);
      const fit = fitViewToBounds({ bounds, width, height, paddingPx: 64 });
      viewRef.current = {
        offsetX: fit.offsetX,
        offsetY: fit.offsetY,
        scale: clamp(fit.scale, 0.25, 2.5),
      };
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, [nodes]);

  // Animation loop
  React.useEffect(() => {
    if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
    rafRef.current = window.requestAnimationFrame(frame);
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [frame]);

  const onPointerMove = React.useCallback((e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    pointerRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      inside: true,
    };

    const drag = draggingRef.current;
    if (!drag) return;

    const dx = pointerRef.current.x - drag.startX;
    const dy = pointerRef.current.y - drag.startY;

    viewRef.current.offsetX = drag.startOffsetX + dx;
    viewRef.current.offsetY = drag.startOffsetY + dy;
  }, []);

  const onPointerDown = React.useCallback((e: React.PointerEvent) => {
    (e.currentTarget as HTMLCanvasElement).setPointerCapture(e.pointerId);

    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    draggingRef.current = {
      startX: x,
      startY: y,
      startOffsetX: viewRef.current.offsetX,
      startOffsetY: viewRef.current.offsetY,
    };
  }, []);

  const onPointerUp = React.useCallback((e: React.PointerEvent) => {
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const drag = draggingRef.current;
    draggingRef.current = null;

    // Treat a short movement as a click/tap.
    if (drag) {
      const dx = x - drag.startX;
      const dy = y - drag.startY;
      const moved = Math.hypot(dx, dy);
      if (moved < 6) {
        const picked = pickNode(x, y);
        if (picked) {
          selectCommunity({
            id: picked.id,
            handle: picked.handle,
            name: picked.name,
            avatarUrl: picked.avatarUrl ?? null,
            icon: picked.icon ?? null,
          });
        }
      }
    }

    try {
      (e.currentTarget as HTMLCanvasElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }, [pickNode, selectCommunity]);

  const onPointerLeave = React.useCallback(() => {
    pointerRef.current.inside = false;
  }, []);

  const onWheel = React.useCallback((e: React.WheelEvent) => {
    e.preventDefault();

    const canvas = e.currentTarget as HTMLCanvasElement;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const v = viewRef.current;
    const before = screenToWorld(sx, sy);

    // trackpad-friendly
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 0.9;
    const nextScale = clamp(v.scale * factor, 0.18, 4);

    v.scale = nextScale;

    const after = screenToWorld(sx, sy);
    // Adjust offsets so the point under cursor stays under cursor.
    v.offsetX += (after.x - before.x) * v.scale;
    v.offsetY += (after.y - before.y) * v.scale;
  }, [screenToWorld]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}
    >
      <canvas
        ref={canvasRef}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onWheel={onWheel}
        style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }}
        aria-label="Community universe"
        role="img"
      />

      {tooltip ? (
        <div
          style={{
            position: "absolute",
            left: tooltip.x + 12,
            top: tooltip.y + 12,
            pointerEvents: "none",
            padding: "8px 10px",
            borderRadius: 10,
            backdropFilter: "blur(10px)",
            background: "rgba(0,0,0,0.55)",
            color: "rgba(255,255,255,0.95)",
            fontSize: 12,
            lineHeight: "16px",
            maxWidth: 260,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          <div style={{ fontWeight: 600 }}>{tooltip.name}</div>
          <div style={{ opacity: 0.8 }}>@{tooltip.handle}</div>
        </div>
      ) : null}

      {nodes.length === 0 ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
          }}
        >
          <div style={{ opacity: 0.65, fontSize: 14 }}>No communities yet</div>
        </div>
      ) : null}
    </div>
  );
}
