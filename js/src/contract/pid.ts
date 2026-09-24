// PID faceplate operator rules (IND-030 .. IND-034): the front-end port of
// PIDFaceplate.sp_limits, the sp / op validators, operator_set and the setpoint
// tracking of _on_loop_mode (src/anywidget_instruments/_pid.py). Both are
// checked against the shared cases of tests/parity/pid.json.

export interface PIDState {
  pv: number;
  sp: number;
  op: number;
  loop_mode: string;
  modes: readonly string[];
  pv_min: number;
  pv_max: number;
  sp_min: number | null;
  sp_max: number | null;
  op_min: number;
  op_max: number;
  confirm_delta: number | null;
  sp_tracking: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Setpoint limits: sp_min / sp_max, or the PV range where not set. */
export function spLimits(s: PIDState): [number, number] {
  return [s.sp_min ?? s.pv_min, s.sp_max ?? s.pv_max];
}

/** Setpoint and output as the kernel stores them (clamped to their limits). */
export function clampedSpOp(s: PIDState): { sp: number; op: number } {
  const [lo, hi] = spLimits(s);
  return { sp: clamp(s.sp, lo, hi), op: clamp(s.op, s.op_min, s.op_max) };
}

export type OperatorResult = { ok: true; field: "sp" | "op"; value: number } | { ok: false; reason: string };

const EDITABLE_IN: Record<string, string> = { sp: "AUTO", op: "MAN" };

/**
 * Operator entry with the faceplate rules: SP in AUTO, OP in MAN, a finite
 * number, clamped to the limits; with confirm_delta a larger change needs
 * `confirmed` (IND-031, IND-032).
 */
export function operatorSet(s: PIDState, field: string, value: unknown, confirmed = false): OperatorResult {
  if (!(field in EDITABLE_IN)) return { ok: false, reason: `unknown field '${field}'` };
  if (s.loop_mode !== EDITABLE_IN[field]) return { ok: false, reason: `${field.toUpperCase()} can only be changed in ${EDITABLE_IN[field]} mode` };
  const v = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(v)) return { ok: false, reason: "not a number" };
  const [lo, hi] = field === "sp" ? spLimits(s) : [s.op_min, s.op_max];
  const next = clamp(v, lo, hi);
  const old = field === "sp" ? s.sp : s.op;
  if (s.confirm_delta !== null && Math.abs(next - old) > s.confirm_delta && !confirmed) return { ok: false, reason: "confirmation required" };
  return { ok: true, field: field as "sp" | "op", value: next };
}

/** Changes of a loop mode request: the new mode and, leaving MAN with sp_tracking, SP = PV (IND-034). */
export function loopModeChange(s: PIDState, mode: string): { ok: true; changes: { loop_mode: string; sp?: number } } | { ok: false; reason: string } {
  if (!s.modes.includes(mode)) return { ok: false, reason: `mode '${mode}' is not enabled` };
  const changes: { loop_mode: string; sp?: number } = { loop_mode: mode };
  if (s.loop_mode === "MAN" && mode !== "MAN" && s.sp_tracking && Number.isFinite(s.pv)) {
    const [lo, hi] = spLimits(s);
    changes.sp = clamp(s.pv, lo, hi);
  }
  return { ok: true, changes };
}
