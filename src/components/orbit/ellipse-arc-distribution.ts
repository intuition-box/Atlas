/**
 * Pre-computed arc-length lookup table for an ellipse.
 *
 * Allows O(log n) conversion between:
 *   - t (0–1 fraction of total perimeter) → θ (radians)
 *   - θ (radians) → t (0–1)
 *
 * Rotation happens in t-space so equal Δt always means
 * equal arc-length distance, regardless of where on
 * the ellipse the node sits.
 */
export class EllipseArcTable {
  /** Cumulative arc-length at each sample, normalized to 0–1 */
  private readonly cumulativeT: Float64Array;
  /** Angle (radians) at each sample */
  private readonly angles: Float64Array;
  private readonly n: number;

  constructor(rx: number, ry: number, samples = 2048) {
    this.n = samples;
    this.cumulativeT = new Float64Array(samples + 1);
    this.angles = new Float64Array(samples + 1);

    let total = 0;
    let px = rx;
    let py = 0;

    this.cumulativeT[0] = 0;
    this.angles[0] = 0;

    for (let i = 1; i <= samples; i++) {
      const theta = (i / samples) * Math.PI * 2;
      const x = Math.cos(theta) * rx;
      const y = Math.sin(theta) * ry;

      total += Math.hypot(x - px, y - py);

      this.angles[i] = theta;
      this.cumulativeT[i] = total;

      px = x;
      py = y;
    }

    // Normalize to 0–1
    for (let i = 1; i <= samples; i++) {
      this.cumulativeT[i] /= total;
    }
  }

  /** Convert arc-length fraction (0–1) to angle (radians). */
  tToAngle(t: number): number {
    // Wrap to [0, 1)
    t = ((t % 1) + 1) % 1;

    // Binary search for the interval containing t
    let lo = 0;
    let hi = this.n;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cumulativeT[mid] < t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    if (lo === 0) return 0;

    // Linear interpolation between samples
    const t0 = this.cumulativeT[lo - 1];
    const t1 = this.cumulativeT[lo];
    const a0 = this.angles[lo - 1];
    const a1 = this.angles[lo];

    const frac = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
    return a0 + frac * (a1 - a0);
  }

  /** Convert angle (radians) to arc-length fraction (0–1). */
  angleToT(angle: number): number {
    // Normalize to [0, 2π)
    angle = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);

    // Binary search — angles array is monotonically increasing
    let lo = 0;
    let hi = this.n;

    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.angles[mid] < angle) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    if (lo === 0) return 0;

    const a0 = this.angles[lo - 1];
    const a1 = this.angles[lo];
    const t0 = this.cumulativeT[lo - 1];
    const t1 = this.cumulativeT[lo];

    const frac = a1 === a0 ? 0 : (angle - a0) / (a1 - a0);
    return t0 + frac * (t1 - t0);
  }
}

/**
 * Distribute `count` nodes evenly by arc length on an ellipse.
 * Returns t-values (0–1 fractions of total perimeter).
 */
export function distributeEvenlyOnEllipse(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i / count);
}
