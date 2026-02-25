import type { OrbitLevel } from "./types";

/* ────────────────────────────
   Geometry (WORLD SPACE, px)
──────────────────────────── */

export const RING_RADII: Record<OrbitLevel, number> = {
  ADVOCATE: 240,
  CONTRIBUTOR: 400,
  PARTICIPANT: 560,
  EXPLORER: 720,
};

export const PERSPECTIVE_RATIO = 0.6;

/* ────────────────────────────
   Rotation (VIEW-SPACE, radians / second)
──────────────────────────── */

export const ORBIT_ROTATION = {
  /** radians per second */
  BASE_SPEED: 0.15,

  /** Per-ring relative angular velocity (dimensionless) */
  SPEED_MULTIPLIER: {
    ADVOCATE: 1.4,
    CONTRIBUTOR: 1.0,
    PARTICIPANT: 0.75,
    EXPLORER: 0.55,
  },
} as const;

/* ────────────────────────────
   Simulation (PHYSICS, unitless forces)
──────────────────────────── */

export const SIMULATION = {
  RADIAL_STRENGTH: 0.3,
  CHARGE_STRENGTH: -8,
  COLLISION_STRENGTH: 1,
  COLLISION_PADDING: 6,
  COLLISION_ITERATIONS: 4,
  /** D3 velocity decay (0–1). Lower = more damping */
  VELOCITY_DECAY: 0.6,
  ALPHA_DECAY: 0.02,
  DRAG_ALPHA: 0.1,
} as const;

/* ────────────────────────────
   Visual
──────────────────────────── */

// Radius in world-space pixels (scaled by zoom in view)
export const NODE_RADIUS = {
  MIN: 9,
  MAX: 18,
} as const;

export const LEVEL_COLORS: Record<OrbitLevel, string> = {
  ADVOCATE: "#3b82f6",
  CONTRIBUTOR: "#38bdf8",
  PARTICIPANT: "#ffffff",
  EXPLORER: "#94a3b8",
};

/* ────────────────────────────
   Interaction
──────────────────────────── */

export const INTERACTION = {
  MIN_ZOOM: 0.3,
  MAX_ZOOM: 3,
  HOVER_SCALE: 1.15,
  /** ms to wait before resuming orbit rotation after interaction */
  RESUME_ROTATION_DELAY: 3000,
} as const;

/* ────────────────────────────
   Universe (HOMEPAGE, community bubbles)
──────────────────────────── */

export const UNIVERSE = {
  /** Smallest community bubble radius (world px) */
  MIN_RADIUS: 14,
  /** Largest community bubble radius (world px) */
  MAX_RADIUS: 44,
  /** Zoom-in animation duration (ms) */
  ZOOM_DURATION: 800,
} as const;

/** Maps dominant orbit level to community bubble color */
export const ORBIT_LEVELS_COLORS: Record<string, string> = {
  advocates: "#3b82f6",
  contributors: "#60a5fa",
  participants: "#ffffff",
  explorers: "#9ca3af",
};

/* ────────────────────────────
   Energy Flow (link animation)
──────────────────────────── */

export const CONNECTION_PHYSICS = {
  /** Spring stiffness pulling midpoint toward center of endpoints */
  SPRING_K: 1.2,
  /** Gravity pulling midpoint downward (world px/s²) */
  GRAVITY: 8,
  /** Velocity damping per second (0 = no damping, 1 = full damping) */
  DAMPING: 8,
  /** Max physics timestep to prevent explosion on tab-switch */
  MAX_DT: 0.05,
  /** Perpendicular bias so alternating links curve different sides */
  SIDE_BIAS: 5,
} as const;

export const ENERGY_FLOW = {
  /** Pulse travel speed (world px per ms) */
  SPEED: 0.05,
  /** Distance between pulse centers (world px) */
  PULSE_SPACING: 100,
  /** Width of each pulse's cosine falloff (world px) */
  PULSE_WIDTH: 60,
  /** World px per sample segment — lower = smoother */
  PX_PER_SAMPLE: 5,
  /** Base link width (before zoom scaling) */
  BASE_WIDTH: 1.5,
  /** Energy glow color — brand primary oklch(0.71 0.13 215) as RGB */
  GLOW_RGB: [0, 181, 212] as readonly [number, number, number],
  /** Peak energy opacity */
  GLOW_OPACITY: 0.9,
  /** Extra width added at peak brightness */
  GLOW_WIDTH_BOOST: 1.5,
  /** Bezier curve offset in world px at rest distance */
  CURVE_AMOUNT: 40,
  /** Sine wave amplitude at rest distance (world px) */
  WAVE_AMPLITUDE: 0.6,
  /** Sine wave frequency — cycles per 100 world px of arc-length */
  WAVE_FREQUENCY: 0.6,
  /** Sine wave phase animation speed (radians per ms) */
  WAVE_SPEED: 0.0008,
} as const;