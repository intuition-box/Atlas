"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type OrbitLevel = "EXPLORER" | "PARTICIPANT" | "CONTRIBUTOR" | "ADVOCATE";

export type OrbitMember = {
  id: string;
  name: string;
  avatarUrl?: string | null;
  headline?: string | null;
  tags?: string[];
  orbitLevel: OrbitLevel;
  reachScore: number;
  lastActiveAt?: string | null; // ISO
};

type HoverPayload = { id: string; x: number; y: number } | null;

type Props = {
  members: OrbitMember[];
  onClickMember: (id: string) => void;
  onHoverChange?: (payload: HoverPayload) => void;
  centerTitle?: string;
  centerSubtitle?: string;
  resetToken?: number;
};

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (
    parts[0]!.slice(0, 1) + parts[parts.length - 1]!.slice(0, 1)
  ).toUpperCase();
}

type CacheEntry = {
  img: HTMLImageElement;
  status: "loading" | "loaded" | "error";
  url: string;
  lastUsed: number;
};

type Circle = { id: string; x: number; y: number; r: number };

class Quadtree {
  private bounds: { x: number; y: number; w: number; h: number };
  private capacity: number;
  private depth: number;
  private maxDepth: number;
  private items: Circle[];
  private children: Quadtree[] | null;

  constructor(
    bounds: { x: number; y: number; w: number; h: number },
    capacity = 12,
    depth = 0,
    maxDepth = 8
  ) {
    this.bounds = bounds;
    this.capacity = capacity;
    this.depth = depth;
    this.maxDepth = maxDepth;
    this.items = [];
    this.children = null;
  }

  clear() {
    this.items = [];
    this.children = null;
  }

  insert(c: Circle) {
    if (!this.intersectsCircle(this.bounds, c)) return false;

    if (!this.children) {
      this.items.push(c);
      if (this.items.length > this.capacity && this.depth < this.maxDepth) {
        this.subdivide();
        const old = this.items;
        this.items = [];
        for (const it of old) this.insert(it);
      }
      return true;
    }

    let inserted = false;
    for (const child of this.children) if (child.insert(c)) inserted = true;
    return inserted;
  }

  queryPoint(px: number, py: number, radius = 0): Circle[] {
    const out: Circle[] = [];
    const range = {
      x: px - radius,
      y: py - radius,
      w: radius * 2,
      h: radius * 2,
    };
    this.queryRect(range, out);
    return out;
  }

  private queryRect(
    range: { x: number; y: number; w: number; h: number },
    out: Circle[]
  ) {
    if (!this.intersectsRect(this.bounds, range)) return;

    if (!this.children) {
      for (const it of this.items) {
        if (
          it.x + it.r >= range.x &&
          it.x - it.r <= range.x + range.w &&
          it.y + it.r >= range.y &&
          it.y - it.r <= range.y + range.h
        ) {
          out.push(it);
        }
      }
      return;
    }

    for (const child of this.children) child.queryRect(range, out);
  }

  private subdivide() {
    const { x, y, w, h } = this.bounds;
    const hw = w / 2;
    const hh = h / 2;
    this.children = [
      new Quadtree(
        { x, y, w: hw, h: hh },
        this.capacity,
        this.depth + 1,
        this.maxDepth
      ),
      new Quadtree(
        { x: x + hw, y, w: hw, h: hh },
        this.capacity,
        this.depth + 1,
        this.maxDepth
      ),
      new Quadtree(
        { x, y: y + hh, w: hw, h: hh },
        this.capacity,
        this.depth + 1,
        this.maxDepth
      ),
      new Quadtree(
        { x: x + hw, y: y + hh, w: hw, h: hh },
        this.capacity,
        this.depth + 1,
        this.maxDepth
      ),
    ];
  }

  private intersectsRect(
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number }
  ) {
    return !(
      b.x > a.x + a.w ||
      b.x + b.w < a.x ||
      b.y > a.y + a.h ||
      b.y + b.h < a.y
    );
  }

  private intersectsCircle(
    rect: { x: number; y: number; w: number; h: number },
    c: Circle
  ) {
    const cx = clamp(c.x, rect.x, rect.x + rect.w);
    const cy = clamp(c.y, rect.y, rect.y + rect.h);
    const dx = c.x - cx;
    const dy = c.y - cy;
    return dx * dx + dy * dy <= c.r * c.r;
  }
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rr, y);
  c.arcTo(x + w, y, x + w, y + h, rr);
  c.arcTo(x + w, y + h, x, y + h, rr);
  c.arcTo(x, y + h, x, y, rr);
  c.arcTo(x, y, x + w, y, rr);
  c.closePath();
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

type CssPalette = {
  background: string;
  foreground: string;
  border: string;
  muted: string;
  mutedForeground: string;
};

function readVar(cs: CSSStyleDeclaration, name: string, fallback: string) {
  const v = cs.getPropertyValue(name).trim();
  return v || fallback;
}

function hslA(triplet: string, a: number) {
  return `hsl(${triplet} / ${clamp(a, 0, 1)})`;
}

export function OrbitCanvas({
  members,
  onClickMember,
  onHoverChange,
  centerTitle,
  centerSubtitle,
  resetToken,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const hoverIdRef = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const timeAnchorRef = useRef<number>(performance.now());

  const qtRef = useRef<Quadtree | null>(null);
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  // viewport (screen-space pan + scale)
  const viewRef = useRef({ scale: 1, panX: 0, panY: 0 });

  const paletteRef = useRef<CssPalette>({
    background: "0 0% 100%",
    foreground: "0 0% 10%",
    border: "0 0% 80%",
    muted: "0 0% 96%",
    mutedForeground: "0 0% 45%",
  });

  useEffect(() => {
    const root = document.documentElement;

    const sync = () => {
      const cs = getComputedStyle(root);
      paletteRef.current = {
        background: readVar(cs, "--background", "0 0% 100%"),
        foreground: readVar(cs, "--foreground", "0 0% 10%"),
        border: readVar(cs, "--border", "0 0% 80%"),
        muted: readVar(cs, "--muted", "0 0% 96%"),
        mutedForeground: readVar(cs, "--muted-foreground", "0 0% 45%"),
      };
    };

    sync();

    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ["class", "style"] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => {
    // Reset zoom + pan
    viewRef.current.scale = 1;
    viewRef.current.panX = 0;
    viewRef.current.panY = 0;
    hoverIdRef.current = null;
    pausedRef.current = false;
    onHoverChange?.(null);
  }, [onHoverChange, resetToken]);

  const prefersReducedMotion = usePrefersReducedMotion();
  const [showLegend, setShowLegend] = useState(false);

  const prepared = useMemo(() => {
    return members.map((m) => {
      const seed = [...m.id].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
      const rand = mulberry32(seed);
      const angle0 = rand() * Math.PI * 2;

      const ring =
        m.orbitLevel === "ADVOCATE"
          ? 0
          : m.orbitLevel === "CONTRIBUTOR"
            ? 1
            : m.orbitLevel === "PARTICIPANT"
              ? 2
              : 3;

      return {
        ...m,
        angle0,
        ring,
        initials: initials(m.name || "Unknown"),
        avatarUrl: m.avatarUrl || null,
      };
    });
  }, [members]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      qtRef.current = new Quadtree({ x: 0, y: 0, w: rect.width, h: rect.height });

      // reset pan if canvas shrinks a lot (avoid lost view)
      const v = viewRef.current;
      v.panX = clamp(v.panX, -rect.width * 0.6, rect.width * 0.6);
      v.panY = clamp(v.panY, -rect.height * 0.6, rect.height * 0.6);
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    function ensureImage(memberId: string, url: string) {
      const cache = cacheRef.current;
      const existing = cache.get(memberId);
      if (existing && existing.url !== url) cache.delete(memberId);
      if (cache.has(memberId)) return;

      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      const entry: CacheEntry = {
        img,
        status: "loading",
        url,
        lastUsed: Date.now(),
      };
      cache.set(memberId, entry);

      img.onload = () => {
        const cur = cache.get(memberId);
        if (cur) cur.status = "loaded";
      };
      img.onerror = () => {
        const cur = cache.get(memberId);
        if (cur) cur.status = "error";
      };

      img.src = url;
    }

    function maybeEvictCache() {
      const cache = cacheRef.current;
      const MAX = 900;
      if (cache.size <= MAX) return;
      const entries = [...cache.entries()].sort(
        (a, b) => a[1].lastUsed - b[1].lastUsed
      );
      for (const [k] of entries.slice(0, cache.size - MAX)) cache.delete(k);
    }

    function recencyAlpha(iso: string | null | undefined) {
      if (!iso) return 0.25;
      const ts = Date.parse(iso);
      if (!Number.isFinite(ts)) return 0.25;
      const days = (Date.now() - ts) / (1000 * 60 * 60 * 24);
      const a = 1 - clamp(days / 30, 0, 1);
      return clamp(0.25 + a * 0.75, 0.25, 1);
    }

    function ringStyle(ring: number) {
      const p = paletteRef.current;
      const strength = clamp(1 - ring * 0.18, 0.46, 1);
      return {
        stroke: hslA(p.foreground, 0.14 * strength),
        label: hslA(p.foreground, 0.55 * strength),
      };
    }

    function drawRingLabels(cx: number, cy: number, radii: number[]) {
      const labels = [
        { ring: 0, text: "Advocates" },
        { ring: 1, text: "Contributors" },
        { ring: 2, text: "Participants" },
        { ring: 3, text: "Explorers" },
      ];

      ctx.save();
      ctx.font = `12px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";

      const angle = -Math.PI / 8;
      for (const l of labels) {
        const r = radii[l.ring] ?? radii[radii.length - 1]!;
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;

        const { label } = ringStyle(l.ring);
        const paddingX = 8;
        const paddingY = 5;
        const metrics = ctx.measureText(l.text);
        const w = Math.ceil(metrics.width) + paddingX * 2;
        const h = 12 + paddingY * 2;

        const bx = x + 10;
        const by = y;

        ctx.fillStyle = hslA(paletteRef.current.background, 0.70);
        roundRect(ctx, bx, by - h / 2, w, h, 10);
        ctx.fill();

        ctx.strokeStyle = hslA(paletteRef.current.border, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = label;
        ctx.fillText(l.text, bx + paddingX, by);
      }

      ctx.restore();
    }

    function drawCenterLabel(cx: number, cy: number) {
      const title = (centerTitle ?? "").trim();
      const sub = (centerSubtitle ?? "").trim();

      if (!title) return;

      const titleFont = 14;
      const subFont = 11;

      ctx.save();

      ctx.font = `600 ${titleFont}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const tw = ctx.measureText(title).width;

      const clippedSub = sub
        ? sub.length > 56
          ? sub.slice(0, 56) + "…"
          : sub
        : "";
      ctx.font = `${subFont}px system-ui, -apple-system, Segoe UI, sans-serif`;
      const sw = clippedSub ? ctx.measureText(clippedSub).width : 0;

      const w = Math.ceil(Math.max(tw, sw)) + 22;
      const h = clippedSub ? 52 : 36;

      const x = cx - w / 2;
      const y = cy - h / 2;

      ctx.fillStyle = hslA(paletteRef.current.background, 0.75);
      roundRect(ctx, x, y, w, h, 14);
      ctx.fill();

      ctx.strokeStyle = hslA(paletteRef.current.border, 0.55);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillStyle = hslA(paletteRef.current.foreground, 0.85);
      ctx.font = `600 ${titleFont}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.fillText(title, cx, clippedSub ? cy - 8 : cy);

      if (clippedSub) {
        ctx.fillStyle = hslA(paletteRef.current.mutedForeground, 0.90);
        ctx.font = `${subFont}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.fillText(clippedSub, cx, cy + 12);
      }

      ctx.restore();
    }

    function drawAvatarCircle(params: {
      x: number;
      y: number;
      r: number;
      memberId: string;
      avatarUrl: string | null;
      initials: string;
      hovered: boolean;
      recencyAlpha: number;
      ring: number;
    }) {
      const {
        x,
        y,
        r,
        memberId,
        avatarUrl,
        initials,
        hovered,
        recencyAlpha,
        ring,
      } = params;

      if (avatarUrl) ensureImage(memberId, avatarUrl);

      const entry = cacheRef.current.get(memberId);
      if (entry) entry.lastUsed = Date.now();

      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.clip();

      if (entry?.status === "loaded") {
        ctx.globalAlpha = clamp(0.7 + recencyAlpha * 0.3, 0.7, 1);
        ctx.drawImage(entry.img, x - r, y - r, r * 2, r * 2);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = hslA(paletteRef.current.muted, 0.80);
        ctx.fillRect(x - r, y - r, r * 2, r * 2);

        ctx.fillStyle = hslA(paletteRef.current.foreground, 0.70);
        ctx.font = `${Math.max(10, Math.floor(r * 0.95))}px system-ui, -apple-system, Segoe UI, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials, x, y + 0.5);
      }

      ctx.restore();

      const innerBoost = clamp(1 - ring * 0.22, 0.45, 1);
      ctx.beginPath();
      ctx.arc(x, y, r + 0.5, 0, Math.PI * 2);
      ctx.lineWidth = hovered ? 2.2 : 1.1;
      ctx.strokeStyle = hovered
        ? hslA(paletteRef.current.foreground, 0.50 * innerBoost)
        : hslA(paletteRef.current.foreground, 0.14 * innerBoost);
      ctx.stroke();
    }

    function pick(mx: number, my: number) {
      const qt = qtRef.current;
      if (!qt) return null;
      const candidates = qt.queryPoint(mx, my, 26 * viewRef.current.scale);
      for (const c of candidates) {
        const dx = mx - c.x;
        const dy = my - c.y;
        if (dx * dx + dy * dy <= c.r * c.r) return c;
      }
      return null;
    }

    function setHover(next: { id: string; x: number; y: number } | null) {
      const nextId = next?.id ?? null;
      const prevId = hoverIdRef.current;

      if (nextId !== prevId) {
        hoverIdRef.current = nextId;
        pausedRef.current = !!nextId;
        if (pausedRef.current) timeAnchorRef.current = performance.now();
        onHoverChange?.(nextId ? next : null);
        canvas.style.cursor = nextId ? "pointer" : "default";
        return;
      }

      if (nextId) onHoverChange?.(next);
    }

    // Pan / zoom interactions (Pointer Events: mouse + touch)
    let dragging = false;
    let pointerDown = false;
    let activePointerId: number | null = null;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let panStartX = 0;
    let panStartY = 0;
    let moved = false;

    const DRAG_THRESHOLD_PX = 3;

    function eventPoint(e: PointerEvent) {
      const br = canvas.getBoundingClientRect();
      return { mx: e.clientX - br.left, my: e.clientY - br.top };
    }

    function onPointerDown(e: PointerEvent) {
      // Only primary button for mouse; touches are always "primary".
      if (e.pointerType === "mouse" && e.button !== 0) return;

      const { mx, my } = eventPoint(e);

      pointerDown = true;
      activePointerId = e.pointerId;
      downX = mx;
      downY = my;
      lastX = mx;
      lastY = my;
      moved = false;

      const hit = pick(mx, my);
      if (hit) {
        // Don't start a drag; allow click/tap on pointer up.
        dragging = false;
        return;
      }

      dragging = true;
      const v = viewRef.current;
      panStartX = v.panX;
      panStartY = v.panY;

      // clear hover while dragging
      setHover(null);
      canvas.style.cursor = "grabbing";

      // capture so we keep getting move/up even if pointer leaves canvas
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    function onPointerMove(e: PointerEvent) {
      const { mx, my } = eventPoint(e);

      // Hover only for mouse pointers.
      if (!pointerDown && e.pointerType === "mouse") {
        const found = pick(mx, my);
        setHover(found ? { id: found.id, x: mx, y: my } : null);
        return;
      }

      if (!pointerDown || activePointerId !== e.pointerId) return;

      const dxFromDown = mx - downX;
      const dyFromDown = my - downY;
      if (!moved && (Math.abs(dxFromDown) > DRAG_THRESHOLD_PX || Math.abs(dyFromDown) > DRAG_THRESHOLD_PX)) {
        moved = true;
      }

      if (!dragging) {
        lastX = mx;
        lastY = my;
        return;
      }

      const v = viewRef.current;
      v.panX = panStartX + dxFromDown;
      v.panY = panStartY + dyFromDown;

      lastX = mx;
      lastY = my;
    }

    function onPointerUp(e: PointerEvent) {
      if (!pointerDown || activePointerId !== e.pointerId) return;

      const { mx, my } = eventPoint(e);

      // Click/tap if we weren't dragging and didn't move meaningfully.
      if (!dragging || !moved) {
        const found = pick(mx, my);
        if (found) onClickMember(found.id);
      }

      pointerDown = false;
      activePointerId = null;
      dragging = false;

      canvas.style.cursor = hoverIdRef.current ? "pointer" : "default";

      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    function onPointerCancel(e: PointerEvent) {
      if (activePointerId !== e.pointerId) return;
      pointerDown = false;
      activePointerId = null;
      dragging = false;
      canvas.style.cursor = "default";
      setHover(null);
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    function onPointerLeave(e: PointerEvent) {
      // Only clear hover for mouse pointers. Touch pointers use drag/click behavior.
      if (e.pointerType !== "mouse") return;
      if (dragging) return;
      hoverIdRef.current = null;
      pausedRef.current = false;
      onHoverChange?.(null);
      canvas.style.cursor = "default";
    }

    const wheelOpts: AddEventListenerOptions = { passive: false };

    function onWheel(e: WheelEvent) {
      e.preventDefault();

      const br = canvas.getBoundingClientRect();
      const mx = e.clientX - br.left;
      const my = e.clientY - br.top;

      const v = viewRef.current;
      const oldScale = v.scale;

      // trackpad-friendly zoom
      const delta = -e.deltaY;
      const zoomFactor = 1 + clamp(delta / 900, -0.18, 0.18);
      const newScale = clamp(oldScale * zoomFactor, 0.7, 2.4);

      if (newScale === oldScale) return;

      // zoom around cursor (keep point under cursor stable)
      const rect = canvas.getBoundingClientRect();
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      const dx = mx - cx - v.panX;
      const dy = my - cy - v.panY;

      const k = newScale / oldScale;
      v.panX = mx - cx - dx * k;
      v.panY = my - cy - dy * k;

      v.scale = newScale;
    }

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerCancel);
    canvas.addEventListener("pointerleave", onPointerLeave);
    canvas.addEventListener("wheel", onWheel, wheelOpts);

    let raf = 0;

    function render(now: number) {
      const rect = canvas.getBoundingClientRect();
      const w = rect.width;
      const h = rect.height;

      const shouldRotate = !prefersReducedMotion;
      const paused = pausedRef.current || !shouldRotate;

      const t = paused ? timeAnchorRef.current : now;
      if (!paused) timeAnchorRef.current = t;

      ctx.clearRect(0, 0, w, h);

      if (!qtRef.current) qtRef.current = new Quadtree({ x: 0, y: 0, w, h });
      const qt = qtRef.current;
      qt.clear();

      const cx = w / 2;
      const cy = h / 2;

      const v = viewRef.current;
      const scale = v.scale;
      const panX = v.panX;
      const panY = v.panY;

      // base radii in “world units”, then scaled
      const radiiWorld = [92, 142, 196, 248];

      // rings
      ctx.lineWidth = 1;
      for (let ring = 0; ring < radiiWorld.length; ring++) {
        const { stroke } = ringStyle(ring);
        ctx.strokeStyle = stroke;

        ctx.beginPath();
        ctx.arc(
          cx + panX,
          cy + panY,
          radiiWorld[ring]! * scale,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }

      drawRingLabels(
        cx + panX,
        cy + panY,
        radiiWorld.map((r) => r * scale)
      );
      drawCenterLabel(cx + panX, cy + panY);

      const hoveredId = hoverIdRef.current;
      const baseSpeed = 0.00009;

      // draw outer-to-inner so inner sits “above”
      const sorted = [...prepared].sort((a, b) => b.ring - a.ring);

      for (const m of sorted) {
        const base = radiiWorld[m.ring] ?? radiiWorld[radiiWorld.length - 1]!;
        const angle = m.angle0 + t * baseSpeed * (m.ring + 1);

        // world coords relative to center
        const wx = Math.cos(angle) * base;
        const wy = Math.sin(angle) * base;

        // screen coords with pan+scale
        const x = cx + panX + wx * scale;
        const y = cy + panY + wy * scale;

        const r = clamp((11 + m.reachScore * 0.15) * scale, 9, 26);
        const hovered = hoveredId === m.id;

        drawAvatarCircle({
          x,
          y,
          r,
          memberId: m.id,
          avatarUrl: m.avatarUrl,
          initials: m.initials,
          hovered,
          recencyAlpha: recencyAlpha(m.lastActiveAt ?? null),
          ring: m.ring,
        });

        qt.insert({ id: m.id, x, y, r });
      }

      maybeEvictCache();
      raf = requestAnimationFrame(render);
    }

    raf = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();

      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel, wheelOpts);
    };
  }, [
    prepared,
    onClickMember,
    onHoverChange,
    centerTitle,
    centerSubtitle,
    prefersReducedMotion,
    resetToken,
  ]);

  return (
    <div className="relative w-full">
      {/* minimal controls */}
      <div className="pointer-events-none absolute right-2 top-2 z-10 flex items-center gap-2">
        <button
          type="button"
          className="pointer-events-auto rounded-lg border border-border bg-background/70 px-2 py-1 text-xs text-foreground opacity-80 backdrop-blur hover:opacity-100"
          onClick={() => setShowLegend((v) => !v)}
          aria-pressed={showLegend}
        >
          {showLegend ? "Hide" : "Legend"}
        </button>

        {prefersReducedMotion ? (
          <span className="rounded-lg border border-border bg-background/70 px-2 py-1 text-xs text-foreground/80 opacity-70 backdrop-blur">
            Reduced motion
          </span>
        ) : null}
      </div>

      {showLegend ? (
        <div className="absolute left-2 top-2 z-10 w-[260px] rounded-xl border border-border bg-background/85 p-3 text-xs text-foreground shadow-sm backdrop-blur">
          <div className="font-medium">Legend</div>
          <div className="mt-2 space-y-1 text-foreground/80">
            <div>Ring: level</div>
            <div>Size: reach</div>
            <div>Brightness: recency</div>
            <div>Drag: pan</div>
            <div>Wheel: zoom</div>
          </div>
        </div>
      ) : null}

      <div className="h-[420px] w-full">
        <canvas ref={canvasRef} className="h-full w-full rounded-xl" />
      </div>
    </div>
  );
}