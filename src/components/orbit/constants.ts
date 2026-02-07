import type { OrbitLevel } from "./types";

/* ────────────────────────────
   Geometry
──────────────────────────── */

export const RING_RADII: Record<OrbitLevel, number> = {
  ADVOCATE: 240,
  CONTRIBUTOR: 400,
  PARTICIPANT: 560,
  EXPLORER: 720,
};

export const PERSPECTIVE_RATIO = 0.6;

/* ────────────────────────────
   Rotation (VIEW ONLY)
──────────────────────────── */

export const ORBIT_ROTATION = {
  /** radians per second */
  BASE_SPEED: 0.15,

  SPEED_MULTIPLIER: {
    ADVOCATE: 1.4,
    CONTRIBUTOR: 1.0,
    PARTICIPANT: 0.75,
    EXPLORER: 0.55,
  },
} as const;

/* ────────────────────────────
   Simulation (NO ANGULAR MOTION)
──────────────────────────── */

export const SIMULATION = {
  RADIAL_STRENGTH: 0.3,
  CHARGE_STRENGTH: -8,
  COLLISION_STRENGTH: 1,
  COLLISION_PADDING: 6,
  COLLISION_ITERATIONS: 4,
  VELOCITY_DECAY: 0.6,
  ALPHA_DECAY: 0.02,
  DRAG_ALPHA: 0.1,
} as const;

/* ────────────────────────────
   Visual
──────────────────────────── */

export const LEVEL_COLORS: Record<OrbitLevel, string> = {
  ADVOCATE: "#3b82f6",
  CONTRIBUTOR: "#38bdf8",
  PARTICIPANT: "#ffffff",
  EXPLORER: "#94a3b8",
};

export const NODE_RADIUS = {
  MIN: 9,
  MAX: 18,
} as const;

/* ────────────────────────────
   Interaction
──────────────────────────── */

export const INTERACTION = {
  MIN_ZOOM: 0.3,
  MAX_ZOOM: 3,
  HOVER_SCALE: 1.15,
  RESUME_ROTATION_DELAY: 3000,
} as const;