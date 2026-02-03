import type { OrbitLevel } from "./types";

/* ────────────────────────────
   Orbit Ring Configuration
──────────────────────────── */

/** Radii for each orbit level (from center outward) */
export const RING_RADII: Record<OrbitLevel, number> = {
  ADVOCATE: 120,
  CONTRIBUTOR: 200,
  PARTICIPANT: 280,
  EXPLORER: 360,
};

/** Ring index for force simulation */
export const LEVEL_TO_RING: Record<OrbitLevel, number> = {
  ADVOCATE: 0,
  CONTRIBUTOR: 1,
  PARTICIPANT: 2,
  EXPLORER: 3,
};

/** Labels for orbit rings */
export const RING_LABELS: Record<OrbitLevel, string> = {
  ADVOCATE: "Advocates",
  CONTRIBUTOR: "Contributors",
  PARTICIPANT: "Participants",
  EXPLORER: "Explorers",
};

/* ────────────────────────────
   Visual Styling
──────────────────────────── */

/** Colors for each orbit level */
export const LEVEL_COLORS: Record<OrbitLevel, string> = {
  ADVOCATE: "#3b82f6",    // Brand blue
  CONTRIBUTOR: "#38bdf8", // Light blue
  PARTICIPANT: "#ffffff", // White
  EXPLORER: "#94a3b8",    // Grey
};

/** Node radius range based on reach score */
export const NODE_RADIUS = {
  MIN: 3,
  MAX: 9,
} as const;

/* ────────────────────────────
   Animation Timing
──────────────────────────── */

export const ANIMATION = {
  /** Duration for nodes to fade in (ms) */
  FADE_IN_DURATION: 500,
  /** Delay before bridges start growing (ms) */
  BRIDGE_DELAY: 400,
  /** Duration for bridges to grow (ms) */
  BRIDGE_DURATION: 600,
} as const;

/* ────────────────────────────
   Force Simulation Config
──────────────────────────── */

export const SIMULATION = {
  /** Strength of radial/elliptical force (keeps nodes in their rings) */
  RADIAL_STRENGTH: 1.2,
  /** Strength of charge force (node repulsion) */
  CHARGE_STRENGTH: -20,
  /** Strength of collision force */
  COLLISION_STRENGTH: 0.8,
  /** Padding between nodes */
  COLLISION_PADDING: 4,
  /** Alpha decay rate */
  ALPHA_DECAY: 0.02,
  /** Velocity decay rate */
  VELOCITY_DECAY: 0.3,
  /** Link distance */
  LINK_DISTANCE: 80,
  /** Link strength multiplier */
  LINK_STRENGTH: 0.1,
  /** Perspective ratio for elliptical orbits (Y squash factor) */
  PERSPECTIVE_RATIO: 0.7,
  /** Rotation speed for orbit animation (radians per second) */
  ROTATION_SPEED: 0.08,
} as const;

/* ────────────────────────────
   Interaction Config
──────────────────────────── */

export const INTERACTION = {
  /** Minimum zoom scale */
  MIN_ZOOM: 0.3,
  /** Maximum zoom scale */
  MAX_ZOOM: 3,
  /** Hover radius multiplier */
  HOVER_SCALE: 1.15,
  /** Delay before resuming rotation after hover (ms) */
  RESUME_ROTATION_DELAY: 3000,
} as const;

/* ────────────────────────────
   Node Spacing Config
──────────────────────────── */

export const NODE_SPACING = {
  /** Minimum gap between node edges (in pixels) */
  MIN_GAP: 4,
} as const;
