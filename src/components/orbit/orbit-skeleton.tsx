import { RING_RADII, PERSPECTIVE_RATIO } from "./constants";
import type { OrbitLevel } from "./types";

const RING_LEVELS: OrbitLevel[] = [
  "ADVOCATE",
  "CONTRIBUTOR",
  "PARTICIPANT",
  "EXPLORER",
];

interface OrbitSkeletonProps {
  className?: string;
}

/**
 * Lightweight skeleton for the orbit loading state.
 * 4 ring ellipses + a center circle — pure CSS, no canvas.
 */
export function OrbitSkeleton({ className }: OrbitSkeletonProps) {
  return (
    <div
      className={className}
      role="img"
      aria-label="Loading orbit"
    >
      {RING_LEVELS.map((level) => {
        const rx = RING_RADII[level];
        const ry = rx * PERSPECTIVE_RATIO;
        return (
          <div
            key={level}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-slate-400/15"
            style={{ width: rx * 2, height: ry * 2 }}
          />
        );
      })}

      {/* Center circle */}
      <div className="absolute left-1/2 top-1/2 size-16 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full bg-slate-400/15" />
    </div>
  );
}
