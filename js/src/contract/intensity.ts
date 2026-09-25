// IntensityChart history and cursor row (CHART-101, CHART-104): the
// front-end port of the row buffer and of IntensityChart.values_at
// (src/anywidget_instruments/_graphs.py), checked against
// tests/parity/intensity.json.

/** Python's round(): halves go to the even integer. */
export function roundHalfEven(v: number): number {
  const r = Math.round(v);
  return Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** Ring of `history` rows of `bins` values, in a single Float32Array. */
export class RowRing {
  readonly history: number;
  readonly bins: number;
  readonly data: Float32Array;
  /** Rows appended since the last clear. */
  total = 0;

  constructor(history: number, bins: number) {
    this.history = history;
    this.bins = bins;
    this.data = new Float32Array(history * bins).fill(NaN);
  }

  /**
   * Store the last `n` rows of an append (or snapshot) whose running count
   * is `total`: row r is absolute row total - n + r. Rows missing from a
   * short buffer are stored as NaN (never read past the buffer).
   */
  store(rows: Float32Array, n: number, total: number): void {
    const count = Math.min(n, Math.floor(rows.length / this.bins));
    const start = total - n;
    for (let r = Math.max(0, n - this.history); r < n; r++) {
      const slot = ((start + r) % this.history) * this.bins;
      if (r < count) this.data.set(rows.subarray(r * this.bins, (r + 1) * this.bins), slot);
      else this.data.fill(NaN, slot, slot + this.bins);
    }
    this.total = total;
  }

  /** True when absolute row `i` is still kept. */
  has(i: number): boolean {
    return i >= 0 && i < this.total && i >= this.total - this.history;
  }

  /** Values of absolute row `i`, or null when it is not kept. */
  row(i: number): Float32Array | null {
    if (!this.has(i)) return null;
    const slot = (i % this.history) * this.bins;
    return this.data.subarray(slot, slot + this.bins);
  }
}

/** Absolute row shown at time `x` (rows are dt apart). */
export function rowIndexAt(x: number, dt: number): number {
  return dt ? roundHalfEven(x / dt) : 0;
}
