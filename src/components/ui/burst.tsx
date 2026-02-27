"use client";

import { motion } from "motion/react";

type BurstProps = {
  /** Emoji character to burst */
  emoji: string;
  /** Callback when the animation completes */
  onDone?: () => void;
};

/**
 * Single emoji burst — flies upward in an arc then fades out.
 * ~1s total. Renders at the parent's center via absolute positioning.
 *
 * Wrap in a `pointer-events-none` container positioned where you want the burst origin.
 */
export function Burst({ emoji, onDone }: BurstProps) {
  return (
    <motion.span
      className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
      initial={{ opacity: 0, scale: 0.5, y: 0 }}
      animate={{
        y: [0, -70, -70, 0],
        opacity: [0, 1, 1, 0],
        scale: [0.5, 1.2, 1.2, 0.5],
        rotate: [0, -8, 8, 0],
      }}
      transition={{ duration: 0.9, ease: [0.2, 0, 0.57, 0] }}
      onAnimationComplete={onDone}
    >
      <span className="text-3xl leading-none">{emoji}</span>
    </motion.span>
  );
}
