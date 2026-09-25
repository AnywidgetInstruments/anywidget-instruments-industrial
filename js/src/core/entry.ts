// Form entry of numeric values (API-014, NUM-010).
import { formatValue, parseEntry, radixOf, withUnit } from "./format.js";
import { snap } from "./scale.js";

/**
 * Check a typed entry against the scale (NUM-010): a number, snapped to
 * `step`, inside [min, max] (clamped instead when `coerce` is set).
 */
export interface EntryOptions {
  min: number;
  max: number;
  step?: number;
  unit?: string;
  coerce?: boolean;
  format?: string;
}

export type EntryResult = { ok: true; value: number } | { ok: false; reason: string };

export function checkEntry(text: unknown, { min, max, step = 0, unit = "", coerce = false, format = "%.1f" }: EntryOptions): EntryResult {
  const v = parseEntry(text, unit, radixOf(format));
  const range = `${withUnit(formatValue(min, format), unit)} … ${withUnit(formatValue(max, format), unit)}`;
  if (!Number.isFinite(v)) return { ok: false, reason: `Not a number: enter a value between ${range}` };
  if ((v < min || v > max) && !coerce) return { ok: false, reason: `Out of range: enter a value between ${range}` };
  return { ok: true, value: snap(v, min, max, step) };
}
