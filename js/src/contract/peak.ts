// Peak hold (NUM-110): the front-end port of _PeakMixin._track_peak
// (src/anywidget_instruments_industrial/_numeric.py). Both are checked against the
// shared cases of tests/parity/peak.json.

export interface PeakState {
  /** Held peak, null when none. */
  peak: number | null;
  /** Time the peak was taken, in seconds of a monotonic clock. */
  time: number;
}

/**
 * New peak state after `value` arrives at time `now` (seconds), or null when
 * the peak does not change. A higher value is taken at once; a lower one
 * replaces the peak only when the held peak is older than `decay` seconds
 * (decay 0: held until reset). Non-finite values are ignored.
 */
export function nextPeak(value: number, state: PeakState, { hold, decay, now }: { hold: boolean; decay: number; now: number }): PeakState | null {
  if (!hold || !Number.isFinite(value)) return null;
  const expired = decay > 0 && now - state.time > decay;
  if (state.peak === null || value >= state.peak || expired) return { peak: value, time: now };
  return null;
}
