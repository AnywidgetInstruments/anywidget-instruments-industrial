// Numeric rules shared with the Python kernel (NUM-006, NUM-010, HOST-002).
// Python: NumericWidget._coerce_value and _check_scale (_numeric.py); both
// sides are checked against tests/parity/numeric.json.
import { clamp } from "anywidget-instruments/js/src/core/scale.js";

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
      console.warn(`anywidget-instruments-industrial: ${where}: invalid scale (min ${s.min}, max ${s.max}, ${s.scale}); keeping min ${this.last.min}, max ${this.last.max}`);
    }
    return this.last;
  }
}

export interface ValueLabel {
  value: number;
  label: string;
}

/**
 * Usable `value_labels` sorted by value (IND-118). The kernel refuses an
 * invalid item; without a kernel an item lacking a finite value or a label
 * is dropped, and of two items with the same value the first is kept.
 */
export function normalizeValueLabels(raw: unknown): ValueLabel[] {
  const out: ValueLabel[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const it = (item && typeof item === "object" ? item : {}) as { value?: unknown; label?: unknown };
    if (typeof it.value !== "number" || !Number.isFinite(it.value) || typeof it.label !== "string" || !it.label.trim()) continue;
    if (out.some((o) => o.value === it.value)) continue;
    out.push({ value: it.value, label: it.label });
  }
  return out.sort((a, b) => a.value - b.value);
}

/** Label of `value` (within 1e-9 of the scale span), or null. Python: value_label_of. */
export function valueLabelOf(labels: ValueLabel[], value: number, lo: number, hi: number): string | null {
  if (!Number.isFinite(value)) return null;
  const tol = 1e-9 * Math.max(1, Math.abs(hi - lo));
  for (const it of labels) if (Math.abs(it.value - value) <= tol) return it.label;
  return null;
}

/** Value of the label `text` (case and surrounding spaces ignored), or null. Python: value_of_label. */
export function valueOfLabel(labels: ValueLabel[], text: string): number | null {
  const key = text.trim().toLowerCase();
  for (const it of labels) if (it.label.trim().toLowerCase() === key) return it.value;
  return null;
}
