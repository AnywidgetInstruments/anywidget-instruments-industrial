// Polar family (SPEC-002 .. SPEC-004): angle mapping, Smith chart
// conversions and radar axis ranges. The conversions are the front-end
// ports of SmithChart.gamma / SmithChart.impedance and the ranges follow
// RadarChart's rule (src/anywidget_instruments/_polar.py); both sides are
// checked against tests/parity/polar.json.

export interface AngleConvention {
  unit?: "deg" | "rad";
  zero?: "E" | "N";
  direction?: "ccw" | "cw";
}

/** Screen angle (degrees, counterclockwise from east) of a data angle. */
export function screenAngle(theta: number, { unit = "deg", zero = "E", direction = "ccw" }: AngleConvention = {}): number {
  const deg = unit === "rad" ? (theta * 180) / Math.PI : theta;
  return (zero === "N" ? 90 : 0) + (direction === "cw" ? -deg : deg);
}

/** Reflection coefficient Γ = (Z - z0) / (Z + z0) of an impedance Z = re + j·im (ohms). */
export function zToGamma(re: number, im: number, z0: number): [number, number] {
  // (a + jb) / (c + jb) with a = re - z0, c = re + z0
  const a = re - z0;
  const c = re + z0;
  const den = c * c + im * im;
  return den === 0 ? [NaN, NaN] : [(a * c + im * im) / den, (im * c - a * im) / den];
}

/** Normalized impedance z / z0 of a reflection coefficient Γ = re + j·im; [Infinity, 0] at Γ = 1. */
export function gammaToZ(re: number, im: number): [number, number] {
  const den = (1 - re) ** 2 + im ** 2;
  return den === 0 ? [Infinity, 0] : [(1 - re * re - im * im) / den, (2 * im) / den];
}

/**
 * [min, max] of radar axis `k`: the range given for it when valid (max > min,
 * as RadarChart requires), otherwise from 0 to the largest value of the data sets.
 */
export function radarRange(ranges: readonly unknown[], values: ReadonlyArray<readonly unknown[]>, k: number): [number, number] {
  const r = ranges[k];
  if (Array.isArray(r) && r.length === 2) {
    const [lo, hi] = r.map(Number);
    if (Number.isFinite(lo) && Number.isFinite(hi) && hi > lo) return [lo, hi];
  }
  return [0, Math.max(1e-12, ...values.map((v) => Number(v[k]) || 0))];
}
