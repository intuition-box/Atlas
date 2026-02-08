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
const ellipseTableCache = new Map<string, EllipseArcTable>();

export class EllipseArcTable {
  /** Cumulative arc-length at each sample, normalized to 0–1 */
  private readonly cumulativeArc!: Float64Array;
  /** Angle (radians) at each sample */
  private readonly angles!: Float64Array;
  private readonly n!: number;

  constructor(rx: number, ry: number, samples?: number) {
    // Cache by geometric shape + sampling resolution
    const key = `${rx}:${ry}:${samples ?? "auto"}`;
    const cached = ellipseTableCache.get(key);
    if (cached) {
      return cached;
    }

    // Sampling heuristic:
    // - scales with ellipse size (rx + ry)
    // - enforces a high minimum to avoid visible spacing artifacts
    const adaptiveSamples =
      samples ??
      Math.max(2048, Math.ceil((rx + ry) * 2));

    this.n = adaptiveSamples;
    this.cumulativeArc = new Float64Array(this.n + 1);
    this.angles = new Float64Array(this.n + 1);

    let total = 0;
    let px = rx;
    let py = 0;

    this.cumulativeArc[0] = 0;
    this.angles[0] = 0;

    for (let i = 1; i <= this.n; i++) {
      const theta = (i / this.n) * Math.PI * 2;
      const x = Math.cos(theta) * rx;
      const y = Math.sin(theta) * ry;

      total += Math.hypot(x - px, y - py);

      this.angles[i] = theta;
      this.cumulativeArc[i] = total;

      px = x;
      py = y;
    }

    // Normalize to 0–1
    for (let i = 1; i <= this.n; i++) {
      this.cumulativeArc[i] /= total;
    }

    Object.freeze(this);
    ellipseTableCache.set(key, this);
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
      if (this.cumulativeArc[mid] < t) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    if (lo === 0) return 0;

    // Linear interpolation between samples
    const t0 = this.cumulativeArc[lo - 1];
    const t1 = this.cumulativeArc[lo];
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
    const t0 = this.cumulativeArc[lo - 1];
    const t1 = this.cumulativeArc[lo];

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
