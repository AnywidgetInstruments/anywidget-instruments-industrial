// Bar graph rules (IND-102): the front-end port of BarGraph._check_bars and
// BarGraph._update_levels (src/anywidget_instruments_industrial/_compact.py). Both are
// checked against the shared cases of tests/parity/bars.json.
import { type AlarmLevel, computeAlarmLevel } from "./alarm.js";

export const BAR_LIMITS = ["normal_lo", "normal_hi", "lolo", "lo", "hi", "hihi"] as const;

export interface Bar {
  label: string;
  normal_lo: number | null;
  normal_hi: number | null;
  lolo: number | null;
  lo: number | null;
  hi: number | null;
  hihi: number | null;
}

const opt = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Bars as the kernel stores them: a label becomes {label}, a missing or
 * non-finite limit is null, the default label is the bar number. Unknown
 * keys (refused by the kernel) are ignored; other items are dropped.
 */
export function normalizeBars(raw: unknown): Bar[] {
  if (!Array.isArray(raw)) return [];
  const out: Bar[] = [];
  raw.forEach((item, i) => {
    let bar: Record<string, unknown>;
    if (typeof item === "string") bar = { label: item };
    else if (item && typeof item === "object" && !Array.isArray(item)) bar = item as Record<string, unknown>;
    else return;
    const clean = { label: "label" in bar && bar.label !== null && bar.label !== undefined ? String(bar.label) : String(i + 1) } as Bar;
    for (const key of BAR_LIMITS) clean[key] = opt(bar[key]);
    out.push(clean);
  });
  return out;
}

/** Alarm level of each bar from its value and limits, with hysteresis; a bar without a value is normal. */
export function barLevels(values: readonly number[], bars: readonly Bar[], deadband: number, previous: readonly string[]): AlarmLevel[] {
  return bars.map((bar, i) => {
    if (i >= values.length) return "normal";
    const prev = (previous[i] ?? "normal") as AlarmLevel;
    return computeAlarmLevel(values[i], { lolo: bar.lolo, lo: bar.lo, hi: bar.hi, hihi: bar.hihi, deadband, previous: prev });
  });
}
