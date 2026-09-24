// Numeric rules shared with the Python kernel (NUM-006, NUM-010, HOST-002).
// Python: NumericWidget._coerce_value and _check_scale (_numeric.py); both
// sides are checked against tests/parity/numeric.json.
import { clamp } from "../core/scale.js";

/**
 * Value as the kernel stores it: clamped to [min, max] when `coerce` is set
 * and the value is finite. Without `coerce` a value set by the host outside
 * the range is kept (the display pins it and shows OVER / UNDER, NUM-006).
 */
export function coerceValue(value: number, min: number, max: number, coerce: boolean): number {
  return coerce && Number.isFinite(value) ? clamp(value, min, max) : value;
}

export interface Scale {
  min: number;
  max: number;
  scale: string;
}

/** A usable scale: finite, max > min, and min > 0 on a log scale. */
export function validScale({ min, max, scale }: Scale): boolean {
  return Number.isFinite(min) && Number.isFinite(max) && max > min && (scale !== "log" || min > 0);
}

/**
 * Keeps the last valid scale. The kernel refuses an invalid scale (it
 * raises); a host without a kernel can send one, and the front end then
 * draws with the last valid scale (initially `fallback`) instead of
 * producing NaN geometry.
 */
export class ScaleGuard {
  private last: Scale;
  private warned = false;

  constructor(fallback: Scale = { min: 0, max: 100, scale: "linear" }) {
    this.last = fallback;
  }

  resolve(s: Scale, where = "widget"): Scale {
    if (validScale(s)) {
      this.last = { ...s };
      this.warned = false;
      return this.last;
    }
    if (!this.warned) {
      this.warned = true;
      console.warn(`anywidget-instruments: ${where}: invalid scale (min ${s.min}, max ${s.max}, ${s.scale}); keeping min ${this.last.min}, max ${this.last.max}`);
    }
    return this.last;
  }
}
