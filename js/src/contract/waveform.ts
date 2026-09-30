// WaveformChart history and cursor readout (CHART-001 .. CHART-009,
// CHART-104): the front-end port of the ring buffer and of
// WaveformChart.values_at (src/anywidget_instruments_industrial/_chart.py). Both are
// checked against tests/parity/waveform.json.

export type UpdateMode = "strip" | "scope" | "sweep";

/** Ring buffer of `capacity` rows × `k` traces, stored trace-major. */
export class Ring {
  readonly capacity: number;
  readonly k: number;
  data: Float32Array[];
  /** Samples appended since the last clear. */
  total = 0;

  constructor(capacity: number, k: number) {
    this.capacity = capacity;
    this.k = k;
    this.data = Array.from({ length: k }, () => new Float32Array(capacity).fill(NaN));
  }

  /** Append rows from a row-major array of n rows (only the last `capacity` are kept). */
  push(rows: ArrayLike<number>, n: number): void {
    const { capacity, k } = this;
    const skip = Math.max(0, n - capacity);
    for (let i = skip; i < n; i++) {
      const slot = (this.total + i) % capacity;
      for (let j = 0; j < k; j++) this.data[j][slot] = rows[i * k + j];
    }
    this.total += n;
  }

  /** True when absolute sample index `idx` is still buffered. */
  has(idx: number): boolean {
    return idx >= 0 && idx < this.total && idx >= this.total - this.capacity;
  }

  /** Value of trace j at absolute sample index idx (NaN if no longer buffered). */
  at(j: number, idx: number): number {
    return this.has(idx) ? this.data[j][idx % this.capacity] : NaN;
  }

  copy(): Ring {
    const r = new Ring(this.capacity, this.k);
    r.data = this.data.map((d) => d.slice());
    r.total = this.total;
    return r;
  }
}

export interface ViewWindow {
  /** Absolute sample window [start, end) displayed. */
  start: number;
  end: number;
  /** x position, in samples from the left edge, of absolute sample i. */
  xOf: (i: number) => number;
  /** Sweep cursor position in samples, or null. */
  cursor: number | null;
}

/** Samples displayed for an update mode. */
export function viewWindow(mode: UpdateMode | string, total: number, history: number): ViewWindow {
  if (mode === "scope") {
    const start = total === 0 ? 0 : Math.floor((total - 1) / history) * history;
    return { start, end: total, xOf: (i) => i - start, cursor: null };
  }
  if (mode === "sweep") {
    const start = Math.max(0, total - history);
    return { start, end: total, xOf: (i) => i % history, cursor: total % history };
  }
  const start = Math.max(0, total - history);
  return { start, end: total, xOf: (i) => i - (total - history), cursor: null };
}

/** Absolute (fractional) sample index shown at x-axis position `x`. */
export function sampleIndexAt(x: number, { mode, dt, total, history }: { mode: UpdateMode | string; dt: number; total: number; history: number }): number {
  const i = dt ? x / dt : 0;
  if (mode === "sweep" && total) {
    const last = total - 1;
    const slot = ((i % history) + history) % history;
    return last - ((((last - slot) % history) + history) % history);
  }
  return i;
}

/**
 * Value of each trace at x-axis position `x`: linear interpolation between
 * the two buffered samples around it; NaN when the sample is not buffered.
 */
export function valuesAt(ring: Ring, x: number, { mode, dt }: { mode: UpdateMode | string; dt: number }): number[] {
  const i = sampleIndexAt(x, { mode, dt, total: ring.total, history: ring.capacity });
  const i0 = Math.floor(i);
  const f = i - i0;
  return Array.from({ length: ring.k }, (_, j) => {
    if (!ring.has(i0)) return NaN;
    const a = ring.at(j, i0);
    if (f === 0 || !ring.has(i0 + 1)) return a;
    return a * (1 - f) + ring.at(j, i0 + 1) * f;
  });
}
