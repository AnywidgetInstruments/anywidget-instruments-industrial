// Alarm levels with hysteresis (ALARM-002, ALARM-003): the front-end port of
// compute_alarm_level (src/anywidget_instruments/_alarm_logic.py). Both are
// checked against the shared cases of tests/parity/alarm_level.json.

export const ALARM_LEVELS = ["normal", "lo", "lolo", "hi", "hihi"] as const;
export type AlarmLevel = (typeof ALARM_LEVELS)[number];

export interface AlarmLimits {
  lolo?: number | null;
  lo?: number | null;
  hi?: number | null;
  hihi?: number | null;
  deadband?: number;
  previous?: AlarmLevel;
}

const HIGH: AlarmLevel[] = ["normal", "hi", "hihi"];
const LOW: AlarmLevel[] = ["normal", "lo", "lolo"];

const set = (v: number | null | undefined): v is number => v !== null && v !== undefined;

function rawLevel(value: number, { lolo, lo, hi, hihi }: AlarmLimits): AlarmLevel {
  if (set(hihi) && value >= hihi) return "hihi";
  if (set(hi) && value >= hi) return "hi";
  if (set(lolo) && value <= lolo) return "lolo";
  if (set(lo) && value <= lo) return "lo";
  return "normal";
}

/**
 * Alarm level of `value`. Entering a more severe level is immediate; leaving
 * a level requires the value to move back beyond that level's limit by at
 * least `deadband`. A non-finite value keeps the previous level.
 */
export function computeAlarmLevel(value: number, limits: AlarmLimits = {}): AlarmLevel {
  const previous = limits.previous ?? "normal";
  const deadband = limits.deadband ?? 0;
  if (!Number.isFinite(value)) return previous;
  const raw = rawLevel(value, limits);
  const bounds: Record<string, number | null | undefined> = { lolo: limits.lolo, lo: limits.lo, hi: limits.hi, hihi: limits.hihi };
  for (const [side, sign] of [[HIGH, 1], [LOW, -1]] as const) {
    const p = side.indexOf(previous);
    const r = side.indexOf(raw);
    if (p >= 1 && r >= 0 && r < p) {
      let level = previous;
      while (side.indexOf(level) > r) {
        const limit = bounds[level];
        // still inside the band around the limit -> stay in this level
        if (set(limit) && sign * (value - limit) > -deadband) return level;
        level = side[side.indexOf(level) - 1];
      }
      return raw;
    }
  }
  return raw;
}
