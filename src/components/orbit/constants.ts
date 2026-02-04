import type { OrbitLevel } from "./types";

/* ────────────────────────────
   Orbit Ring Configuration
──────────────────────────── */

/** Radii for each orbit level (from center outward) */
export const RING_RADII: Record<OrbitLevel, number> = {
  ADVOCATE: 240,
  CONTRIBUTOR: 400,
  PARTICIPANT: 560,
  EXPLORER: 720,
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
  MIN: 9,
  MAX: 18,
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
  /** Strength of radial/elliptical force (keeps nodes near their rings) */
  RADIAL_STRENGTH: 0.3,
  /** Strength of charge force (node repulsion - lower = closer together) */
  CHARGE_STRENGTH: -8,
  /** Strength of collision force */
  COLLISION_STRENGTH: 0.8,
  /** Padding between nodes */
  COLLISION_PADDING: 2,
  /** Alpha decay rate */
  ALPHA_DECAY: 0.015,
  /** Velocity decay rate (higher = more damping, less vibration) */
  VELOCITY_DECAY: 0.22,
  /** Link distance */
  LINK_DISTANCE: 80,
  /** Link strength multiplier */
  LINK_STRENGTH: 0.1,
  /** Perspective ratio for elliptical orbits (Y squash factor) */
  PERSPECTIVE_RATIO: 0.6,
  /** Alpha target when dragging (lower = less disturbance to other nodes) */
  DRAG_ALPHA: 0.1,
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
  /** Duration for rotation to decelerate to a stop on hover (ms) */
  ROTATION_DECEL_DURATION: 1000,
} as const;

/* ────────────────────────────
   Orbital Motion (Angular Velocity)
──────────────────────────── */

/**
 * Controls tangential (clockwise) orbital motion around the center.
 * This is used by the custom D3 orbital force, not by CSS animation.
 */
export const ORBITAL_MOTION = {
  /**
   * Base angular velocity applied as tangential force.
   * Higher = faster orbiting. The actual speed depends on alpha and strength.
   */
  ANGULAR_VELOCITY: 0.15,

  /**
   * Speed multiplier per orbit level.
   * Inner rings move faster to mimic gravitational dynamics.
   */
  RING_SPEED_MULTIPLIER: {
    ADVOCATE: 1.4,
    CONTRIBUTOR: 1.0,
    PARTICIPANT: 0.75,
    EXPLORER: 0.55,
  },

  /**
   * How strongly orbital rotation is enforced.
   * 0 = disabled, 1 = fully enforced.
   */
  ROTATION_STRENGTH: 0.05,
} as const;
