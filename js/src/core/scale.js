// Scale computation, value mapping and hit testing (NUM-001..NUM-006).
// Pure functions: no DOM access, unit tested in js/test/scale.test.js.

/** Parse a number coming from the kernel ("nan", "inf" and "-inf" strings included). */
export function parseNumber(v) {
  if (typeof v === "number") return v;
  if (v === null || v === undefined) return NaN;
  if (v === "inf" || v === "Infinity") return Infinity;
  if (v === "-inf" || v === "-Infinity") return -Infinity;
  return Number(v);
}

export function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

/** Map a value to a fraction of the scale (unclamped). */
export function toFraction(v, min, max, scale = "linear") {
  if (scale === "log") {
    const lmin = Math.log10(min);
    return (Math.log10(v) - lmin) / (Math.log10(max) - lmin);
  }
  return (v - min) / (max - min);
}

/** Inverse of toFraction. */
export function fromFraction(f, min, max, scale = "linear") {
  if (scale === "log") {
    const lmin = Math.log10(min);
    return 10 ** (lmin + f * (Math.log10(max) - lmin));
  }
  return min + f * (max - min);
}

/**
 * Display position of a value: the fraction is clamped to [0, 1] and
 * `over` / `under` flag an out-of-range value (NUM-006). A non-finite value
 * gives `invalid: true` and `fraction: null` (NUM-007).
 */
export function position(v, min, max, scale = "linear") {
  if (!Number.isFinite(v)) return { fraction: null, over: false, under: false, invalid: true };
  if (scale === "log" && v <= 0) return { fraction: 0, over: false, under: true, invalid: false };
  const f = toFraction(v, min, max, scale);
  return { fraction: clamp(f, 0, 1), over: f > 1, under: f < 0, invalid: false };
}

/** Snap v to min + k*step and clamp to [min, max] (NUM-005). */
export function snap(v, min, max, step) {
  let out = v;
  if (step > 0) out = min + Math.round((v - min) / step) * step;
  out = clamp(out, min, max);
  // remove binary noise such as 0.30000000000000004
  return Number(out.toPrecision(12));
}

/** Keyboard increment: step or 1 % of the span when step is 0. */
export function keyStep(min, max, step) {
  return step > 0 ? step : (max - min) / 100;
}

/**
 * Major and minor tick values from min, max and a tick count (NUM-001).
 * Linear: about `count` intervals on "nice" values (1, 2, 5 × 10^k) unless
 * `nice` is false (then exactly `count` equal intervals, e.g. a compass).
 * Log: one major tick per decade when the limits allow it, otherwise
 * `count` intervals evenly spaced in log space.
 */
export function ticks(min, max, count = 5, minor = 4, scale = "linear", { nice = true } = {}) {
  const n = Math.max(1, Math.round(count));
  const m = Math.max(0, Math.round(minor));
  if (scale === "log") {
    const a = Math.log10(min);
    const b = Math.log10(max);
    if (Number.isInteger(a) && Number.isInteger(b) && b > a) {
      const major = [];
      const minorTicks = [];
      for (let e = a; e <= b; e++) {
        major.push(10 ** e);
        if (e < b) for (let k = 2; k <= 9; k++) minorTicks.push(k * 10 ** e);
      }
      return { major, minor: minorTicks };
    }
  } else if (nice) {
    const major = niceTicks(min, max, n);
    if (major.length >= 2) {
      const step = major[1] - major[0];
      const sub = step / (m + 1);
      const minorTicks = [];
      if (m > 0) {
        const eps = sub * 1e-6;
        for (let v = Math.ceil((min - eps) / sub) * sub; v <= max + eps; v += sub) {
          const r = Number(v.toPrecision(12));
          const onMajor = Math.abs(r / step - Math.round(r / step)) < 1e-6;
          if (!onMajor && r >= min - eps && r <= max + eps) minorTicks.push(r);
        }
      }
      return { major, minor: minorTicks };
    }
  }
  const major = [];
  const minorTicks = [];
  for (let i = 0; i <= n; i++) {
    major.push(fromFraction(i / n, min, max, scale));
    if (i < n) {
      for (let j = 1; j <= m; j++) {
        minorTicks.push(fromFraction((i + j / (m + 1)) / n, min, max, scale));
      }
    }
  }
  return { major, minor: minorTicks };
}

/** Degrees clockwise from 12 o'clock → point on a circle. */
export function polar(cx, cy, r, deg) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
}

/** Angle (degrees clockwise from 12 o'clock, in (-180, 180]) of point (x, y) around (cx, cy). */
export function angleOf(cx, cy, x, y) {
  return (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
}

/**
 * Hit test for rotary controls: fraction of the scale under the pointer, or
 * null when the pointer is in the dead zone outside the angular range.
 */
export function rotaryHit(cx, cy, x, y, angleRange) {
  const a = angleOf(cx, cy, x, y);
  const half = angleRange / 2;
  if (a < -half || a > half) return null;
  return (a + half) / angleRange;
}

/** Hit test for linear widgets: fraction of the track [start, end] at coordinate p. */
export function linearHit(p, start, end) {
  return clamp((p - start) / (end - start), 0, 1);
}

/** SVG path of an arc (angles in degrees clockwise from 12 o'clock). */
export function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/** Closed annular sector between radii r0 < r1. */
export function sectorPath(cx, cy, r0, r1, a0, a1) {
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const f = (n) => n.toFixed(2);
  return (
    `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 ${large} 1 ${f(x1)} ${f(y1)}` +
    `L${f(x2)} ${f(y2)}A${r0} ${r0} 0 ${large} 0 ${f(x3)} ${f(y3)}Z`
  );
}

/**
 * Y-axis autoscale with hysteresis (CHART-008): expand immediately to include
 * the data, shrink only when the data use less than `shrinkBelow` of the range.
 */
export function autoscale(current, dataMin, dataMax, { pad = 0.05, shrinkBelow = 0.5 } = {}) {
  if (!Number.isFinite(dataMin) || !Number.isFinite(dataMax)) return current;
  let lo = dataMin;
  let hi = dataMax;
  if (hi === lo) {
    const d = Math.abs(hi) * 0.1 || 1;
    lo -= d;
    hi += d;
  }
  const span = hi - lo;
  const target = [lo - pad * span, hi + pad * span];
  const [cmin, cmax] = current;
  const outside = dataMin < cmin || dataMax > cmax;
  const tooWide = span < shrinkBelow * (cmax - cmin);
  return outside || tooWide ? target : current;
}

/**
 * "Nice" axis ticks for graphs: steps of 1, 2 or 5 × 10^k, about `count`
 * intervals, restricted to [min, max].
 */
export function niceTicks(min, max, count = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) {
    out.push(Number((Math.abs(v) < step * 1e-9 ? 0 : v).toPrecision(12)));
  }
  return out;
}
