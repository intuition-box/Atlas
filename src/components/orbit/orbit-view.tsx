"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { OrbitCanvas, type OrbitMember } from "./orbit-canvas";
import OrbitTooltip, { type TooltipMember } from "./orbit-tooltip";

const LEVELS = ["ADVOCATE", "CONTRIBUTOR", "PARTICIPANT", "EXPLORER"] as const;

type Level = (typeof LEVELS)[number];

type Hover = { id: string; x: number; y: number } | null;

type Props = {
  members: OrbitMember[];
  centerTitle?: string;
  centerSubtitle?: string;
};

export default function OrbitView({ members, centerTitle, centerSubtitle }: Props) {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement | null>(null);

  const totalCount = members.length;

  const membersById = useMemo(() => {
    const map = new Map<string, OrbitMember>();
    for (const m of members) map.set(m.id, m);
    return map;
  }, [members]);

  const [hover, setHover] = useState<Hover>(null);

  const [levelOn, setLevelOn] = useState<Record<Level, boolean>>(() => {
    return Object.fromEntries(LEVELS.map((lvl) => [lvl, true])) as Record<Level, boolean>;
  });

  const [tagQuery, setTagQuery] = useState("");
  const [resetToken, setResetToken] = useState(0);

  const filteredMembers = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();

    return members.filter((m) => {
      const lvl = m.orbitLevel as Level;
      if (!(lvl in levelOn)) return false;
      if (!levelOn[lvl]) return false;
      if (!q) return true;

      for (const raw of m.tags ?? []) {
        if (raw.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [members, levelOn, tagQuery]);

  useEffect(() => {
    setHover(null);
  }, [tagQuery, levelOn]);

  const shownCount = filteredMembers.length;

  const hoveredMember: TooltipMember | null = hover
    ? (membersById.get(hover.id) ?? null)
    : null;

  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    });

    ro.observe(el);
    // initial
    const rect = el.getBoundingClientRect();
    setContainerSize({ width: rect.width, height: rect.height });

    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Controls row */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1.5">
            {LEVELS.map((lvl) => {
              const on = levelOn[lvl];

              return (
                <button
                  key={lvl}
                  type="button"
                  aria-pressed={on}
                  className={[
                    "rounded-full border border-border bg-background px-2 py-1 text-xs text-foreground transition-opacity",
                    on ? "opacity-90" : "opacity-40",
                  ].join(" ")}
                  onClick={() =>
                    setLevelOn((s) => ({
                      ...s,
                      [lvl]: !s[lvl],
                    }))
                  }
                >
                  {lvl}
                </button>
              );
            })}
          </div>

          <input
            value={tagQuery}
            onChange={(e) => setTagQuery(e.target.value)}
            placeholder="Filter tag…"
            className="h-8 w-[180px] rounded-lg border border-border bg-background px-2 text-sm text-foreground outline-none placeholder:text-foreground/50"
          />

          <button
            type="button"
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground/80 transition-opacity hover:text-foreground"
            onClick={() => {
              setHover(null);
              setResetToken((x) => x + 1);
            }}
            title="Reset zoom and pan"
          >
            Fit to view
          </button>
        </div>

        <div className="text-xs text-foreground/60">
          {shownCount} / {totalCount} shown
        </div>
      </div>

      <OrbitCanvas
        members={filteredMembers}
        centerTitle={centerTitle}
        centerSubtitle={centerSubtitle}
        resetToken={resetToken}
        onClickMember={(id) => router.push(`/u/${id}`)}
        onHoverChange={setHover}
      />

      {hoveredMember && hover ? (
        <OrbitTooltip
          member={hoveredMember}
          x={hover.x}
          y={hover.y}
          containerWidth={containerSize.width}
          containerHeight={containerSize.height}
        />
      ) : null}
    </div>
  );
}