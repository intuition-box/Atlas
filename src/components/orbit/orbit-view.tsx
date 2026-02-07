"use client";

import { useEffect, useRef, useState } from "react";

import { OrbitCanvas } from "./orbit-canvas";
import { useOrbitSimulation } from "./use-orbit-simulation";
import type { OrbitViewProps } from "./types";

export function OrbitView({
  members,
  links = [],
  centerLogoUrl,
  centerName,
  isMembershipOpen,
  isPublicDirectory,
  onMemberClick,
  className = "",
}: OrbitViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sim = useOrbitSimulation(members, links, size.w / 2, size.h / 2);

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className}`}
      style={{ width: "100vw", height: "100vh" }}
      onMouseEnter={() => sim.setPaused(true)}
      onMouseLeave={() => sim.setPaused(false)}
    >
      {size.w > 0 && size.h > 0 && (
        <OrbitCanvas
          width={size.w}
          height={size.h}
          nodes={sim.nodes}
          onDrag={sim.updateNodePosition}
          onDragEnd={sim.releaseNode}
        />
      )}
    </div>
  );
}
