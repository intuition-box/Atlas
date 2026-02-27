"use client";

import { motion } from "motion/react";

type ExplodeProps = {
  /** Array of emoji characters to scatter */
  emojis: string[];
};

/**
 * Random multi-emoji explosion — each emoji disperses outward in a random
 * direction, then fades out. ~0.7s total. Renders at the parent's center
 * via absolute positioning.
 *
 * Wrap in a `pointer-events-none` container positioned where you want the burst origin.
 */
export function Explode({ emojis }: ExplodeProps) {
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;

  return (
    <div className="absolute inset-0">
      {emojis.map((e, i) => {
        const dx = rand(-80, 80);
        const topY = rand(-90, -140);
        const rot = rand(-25, 25);

        return (
          <motion.span
            key={`${i}-${e}-${dx.toFixed(1)}`}
            className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-2xl"
            initial={{ x: 0, y: 0, scale: 0.5, opacity: 0, rotate: 0 }}
            animate={{
              x: dx,
              y: topY,
              rotate: rot,
              scale: [0.5, 1, 1, 0.95],
              opacity: [0, 1, 1, 0],
            }}
            transition={{
              type: "tween",
              ease: "easeOut",
              duration: 0.7,
            }}
          >
            {e}
          </motion.span>
        );
      })}
    </div>
  );
}
