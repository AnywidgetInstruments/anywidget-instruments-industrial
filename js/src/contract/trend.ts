// TrendChart pens and history (IND-070 .. IND-075, CHART-104): the
// front-end ports of TrendChart._check_pens (for valid pens), of the pen
// buffers and of TrendChart.values_at (src/anywidget_instruments/_trend.py),
// checked against tests/parity/trend.json.
import { parseNumber } from "../core/scale.js";

export interface Pen {
  name: string;
  unit: string;
  min: number;
  max: number;
  color: string;
  format: string;
  lolo: number | null;
  lo: number | null;
  hi: number | null;
  hihi: number | null;
  setpoint: number | null;
}

const LIMITS = ["lolo", "lo", "hi", "hihi", "setpoint"] as const;

const finiteOrNull = (v: unknown): number | null => {
  const f = typeof v === "number" || typeof v === "string" ? parseNumber(v) : NaN;
  return Number.isFinite(f) ? f : null;
};

/**
 * Pen as the host stores it: a string is a pen name, missing keys get
 * their defaults. Python rejects a scale with max <= min; the front end
 * shows it as 0 .. 100.
 */
export function normalizePen(raw: unknown, j: number): Pen {
  const p = (typeof raw === "string" ? { name: raw } : raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let min = finiteOrNull(p.min) ?? 0;
  let max = finiteOrNull(p.max) ?? 100;
  if (!(max > min)) [min, max] = [0, 100];
  const pen: Pen = {
    name: p.name ? String(p.name) : `pen ${j + 1}`,
    unit: p.unit ? String(p.unit) : "",
    min,
    max,
    color: p.color ? String(p.color) : "",
    format: p.format ? String(p.format) : "%.4g",
    lolo: null,
    lo: null,
    hi: null,
    hihi: null,
    setpoint: null,
  };
  for (const k of LIMITS) pen[k] = finiteOrNull(p[k]);
  return pen;
}

/** Circular buffer of (time, value) samples of one pen. */
export class PenRing {
  readonly capacity: number;
  readonly t: Float64Array;
  readonly v: Float32Array;
  /** Samples added since the last clear. */
  total = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.t = new Float64Array(capacity);
    this.v = new Float32Array(capacity);
  }

  /** Store the first n samples of ts / vs (only the last `capacity` are kept). */
  push(ts: ArrayLike<number>, vs: ArrayLike<number>, n: number): void {
    for (let i = Math.max(0, n - this.capacity); i < n; i++) {
      const slot = (this.total + i) % this.capacity;
      this.t[slot] = ts[i];
      this.v[slot] = vs[i];
    }
    this.total += n;
  }

  get size(): number {
    return Math.min(this.total, this.capacity);
  }

  /** Slot of the k-th oldest buffered sample. */
  slot(k: number): number {
    return (this.total - this.size + k) % this.capacity;
  }

  timeAt(k: number): number {
    return this.t[this.slot(k)];
  }

  valueAt(k: number): number {
    return this.v[this.slot(k)];
  }

  get first(): number {
    return this.size ? this.timeAt(0) : NaN;
  }

  get last(): number {
    return this.size ? this.timeAt(this.size - 1) : NaN;
  }

  /** Index of the first sample at or after time t (binary search). */
  lowerBound(t: number): number {
    let lo = 0;
    let hi = this.size;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.timeAt(mid) < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Value at time t, linearly interpolated; NaN outside the buffered span. */
  at(t: number): number {
    const n = this.size;
    if (!n || t < this.first || t > this.last) return NaN;
    const k = this.lowerBound(t);
    if (k >= n) return this.valueAt(n - 1);
    const t1 = this.timeAt(k);
    if (t1 === t || k === 0) return this.valueAt(k);
    const t0 = this.timeAt(k - 1);
    const f = (t - t0) / (t1 - t0 || 1);
    return this.valueAt(k - 1) * (1 - f) + this.valueAt(k) * f;
  }
}
