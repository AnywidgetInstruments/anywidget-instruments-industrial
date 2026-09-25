// Derived traits and who is authoritative for them (HOST-004).
//
// A derived trait (x-awi-writer "derived", e.g. alarm_level) is a pure
// function of other traits and of its own previous value. When a host owns
// the state (non-empty `_session`, e.g. a Python kernel, including a saved
// notebook reopened without it) the host computes it and the front end only
// displays it. Otherwise the front end computes it once per model (not per
// view, so every view agrees), and writes it back so that the host sees it.
import type { AnyModel, Traits } from "../core/model.js";
import { BY_KIND } from "../generated/contract.js";
import { type AlarmLevel, computeAlarmLevel } from "./alarm.js";
import { acknowledgeRows, type AlarmRow, expireShelving, nextExpiry, shelveRow, unshelveRow } from "./alarms.js";
import { hornOn, normalizeWindows, type Panel, panelAction, type Sequence, setProcess } from "./annunciator.js";
import { barLevels, normalizeBars } from "./bars.js";
import { coerceValue } from "./numeric.js";
import { nextPeak, type PeakState } from "./peak.js";
import { clampedSpOp, type PIDState } from "./pid.js";
import { availableCommands, type Machine, normalizeMachine, resolveState } from "./statemachine.js";
import type { WidgetContract } from "./spec.js";
import { readTrait } from "./traits.js";

/** True when a host owns the state and is authoritative for derived traits. */
export function hostOwnsState(model: AnyModel): boolean {
  const s = model.get("_session");
  return typeof s === "string" && s !== "";
}

/** Contract of the widget of `model`, if its `_kind` has a schema. */
export function contractOf(model: AnyModel): WidgetContract | undefined {
  const kind = model.get("_kind");
  return typeof kind === "string" ? BY_KIND[kind] : undefined;
}

/** Reader of the traits of `model` through its contract. */
export function reader(model: AnyModel, contract: WidgetContract): (name: string) => unknown {
  return (name) => {
    const spec = contract.traits[name];
    return spec ? readTrait(spec, model.get(name)) : model.get(name);
  };
}

/**
 * alarm_level of a numeric widget or of the PV of a PID faceplate
 * (ALARM-002, ALARM-003): computed from the trait named by x-awi-source
 * (default value), coerced to [min, max] where the widget has `coerce`.
 */
function attachAlarmLevel(model: AnyModel<Traits>, contract: WidgetContract): () => void {
  const read = reader(model, contract);
  const num = (name: string): number | null => read(name) as number | null;
  const source = contract.traits.alarm_level.source ?? "value";
  const hasCoerce = "coerce" in contract.traits;
  const ALARM_INPUTS = [source, "min", "max", "coerce", "lolo", "lo", "hi", "hihi", "deadband", "alarm_level", "_session"];
  let previous = read("alarm_level") as AlarmLevel;
  let hostLevel = false; // previous is the host's level, read when taking over
  let writing = false;
  const update = (): void => {
    if (writing) return;
    if (hostOwnsState(model)) {
      hostLevel = true;
      return;
    }
    if (hostLevel) {
      previous = read("alarm_level") as AlarmLevel;
      hostLevel = false;
    }
    const raw = num(source) as number;
    const value = hasCoerce ? coerceValue(raw, num("min") as number, num("max") as number, !!read("coerce")) : raw;
    const level = computeAlarmLevel(value, { lolo: num("lolo"), lo: num("lo"), hi: num("hi"), hihi: num("hihi"), deadband: num("deadband") ?? 0, previous });
    previous = level;
    if (model.get("alarm_level") !== level) {
      writing = true;
      try {
        model.set("alarm_level", level);
        model.save_changes();
      } finally {
        writing = false;
      }
    }
  };
  for (const name of ALARM_INPUTS) model.on(`change:${name}`, update);
  update();
  return () => {
    for (const name of ALARM_INPUTS) model.off(`change:${name}`, update);
  };
}

/** Monotonic clock in seconds (the kernel uses time.monotonic). */
const monotonic = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;

/** peak of a numeric widget with peak hold (NUM-110). */
function attachPeak(model: AnyModel<Traits>, contract: WidgetContract, clock: () => number): () => void {
  const read = reader(model, contract);
  const num = (name: string): number => read(name) as number;
  const state: PeakState = { peak: read("peak") as number | null, time: 0 };
  let writing = false;
  const onValue = (): void => {
    if (hostOwnsState(model)) return;
    const value = coerceValue(num("value"), num("min"), num("max"), !!read("coerce"));
    const next = nextPeak(value, state, { hold: !!read("peak_hold"), decay: num("peak_decay") || 0, now: clock() });
    if (!next) return;
    Object.assign(state, next);
    writing = true;
    try {
      model.set("peak", next.peak);
      model.save_changes();
    } finally {
      writing = false;
    }
  };
  // a peak set by the host (e.g. a reset to null) becomes the held peak
  const onPeak = (): void => {
    if (!writing) state.peak = read("peak") as number | null;
  };
  model.on("change:value", onValue);
  model.on("change:peak", onPeak);
  return () => {
    model.off("change:value", onValue);
    model.off("change:peak", onPeak);
  };
}

const BAR_INPUTS = ["value", "bars", "deadband", "alarm_levels", "_session"];

/** alarm_levels of a bar graph (IND-102). */
function attachBarLevels(model: AnyModel<Traits>, contract: WidgetContract): () => void {
  const read = reader(model, contract);
  let previous = (read("alarm_levels") as string[]) || [];
  let writing = false;
  const update = (): void => {
    if (writing) return;
    if (hostOwnsState(model)) {
      previous = (read("alarm_levels") as string[]) || [];
      return;
    }
    const levels = barLevels(read("value") as number[], normalizeBars(read("bars")), Number(read("deadband")) || 0, previous);
    previous = levels;
    if (JSON.stringify(model.get("alarm_levels")) !== JSON.stringify(levels)) {
      writing = true;
      try {
        model.set("alarm_levels", levels);
        model.save_changes();
      } finally {
        writing = false;
      }
    }
  };
  for (const name of BAR_INPUTS) model.on(`change:${name}`, update);
  update();
  return () => {
    for (const name of BAR_INPUTS) model.off(`change:${name}`, update);
  };
}

/** Model of a state machine as the kernel stores it (the schema default when invalid). */
export function machineOf(model: AnyModel, contract: WidgetContract): Machine {
  return normalizeMachine(model.get("machine")) ?? (normalizeMachine(contract.traits.machine.default) as Machine);
}

/** value and available_commands of a state machine (IND-060, IND-061). */
function attachStateMachine(model: AnyModel<Traits>, contract: WidgetContract): () => void {
  const inputs = ["machine", "value", "_session"];
  let writing = false;
  const update = (): void => {
    if (writing || hostOwnsState(model)) return;
    const m = machineOf(model, contract);
    const state = resolveState(m, model.get("value"));
    const available = availableCommands(m, state);
    const changes: Traits = {};
    if (model.get("value") !== state) changes.value = state;
    if (JSON.stringify(model.get("available_commands")) !== JSON.stringify(available)) changes.available_commands = available;
    if (Object.keys(changes).length === 0) return;
    writing = true;
    try {
      for (const [k, v] of Object.entries(changes)) model.set(k, v);
      model.save_changes();
    } finally {
      writing = false;
    }
  };
  for (const name of inputs) model.on(`change:${name}`, update);
  update();
  return () => {
    for (const name of inputs) model.off(`change:${name}`, update);
  };
}

/** value {pv, sp, op, mode} of a PID faceplate (IND-030), with sp / op clamped as the kernel stores them. */
function attachPidSummary(model: AnyModel<Traits>, contract: WidgetContract): () => void {
  const read = reader(model, contract);
  const inputs = ["pv", "sp", "op", "loop_mode", "sp_min", "sp_max", "pv_min", "pv_max", "op_min", "op_max", "_session"];
  let writing = false;
  const update = (): void => {
    if (writing || hostOwnsState(model)) return;
    const { sp, op } = pidState(read);
    const pv = read("pv") as number;
    const summary = { pv: Number.isFinite(pv) ? pv : String(pv).toLowerCase().replace("infinity", "inf"), sp, op, mode: read("loop_mode") };
    if (JSON.stringify(model.get("value")) === JSON.stringify(summary)) return;
    writing = true;
    try {
      model.set("value", summary);
      model.save_changes();
    } finally {
      writing = false;
    }
  };
  for (const name of inputs) model.on(`change:${name}`, update);
  update();
  return () => {
    for (const name of inputs) model.off(`change:${name}`, update);
  };
}

/** Operator-rule state of a PID faceplate, read through its contract, with SP and OP as the kernel stores them (clamped). */
export function pidState(read: (name: string) => unknown): PIDState {
  const n = (k: string): number => read(k) as number;
  const o = (k: string): number | null => read(k) as number | null;
  const s: PIDState = {
    pv: n("pv"), sp: n("sp"), op: n("op"), loop_mode: String(read("loop_mode")), modes: (read("modes") as string[]) || [],
    pv_min: n("pv_min"), pv_max: n("pv_max"), sp_min: o("sp_min"), sp_max: o("sp_max"), op_min: n("op_min"), op_max: n("op_max"),
    confirm_delta: o("confirm_delta"), sp_tracking: !!read("sp_tracking"),
  };
  return { ...s, ...clampedSpOp(s) };
}

/** Per-model annunciator state that is not a trait: the horn silence and the last process conditions seen. */
const PANELS = new WeakMap<object, { silenced: boolean; active: Map<string, boolean> }>();

function panelOf(model: AnyModel, read: (name: string) => unknown): Panel {
  const reg = PANELS.get(model);
  return { windows: normalizeWindows(read("value")), sequence: read("sequence") as Sequence, firstOut: !!read("first_out"), silenced: !!reg?.silenced };
}

function writePanel(model: AnyModel<Traits>, p: Panel): void {
  const reg = PANELS.get(model);
  if (reg) {
    reg.silenced = p.silenced;
    reg.active = new Map(p.windows.map((w) => [w.tag, w.active]));
  }
  const horn = hornOn(p);
  if (JSON.stringify(model.get("value")) === JSON.stringify(p.windows) && model.get("horn") === horn) return;
  model.set("value", p.windows);
  model.set("horn", horn);
  model.save_changes();
}

/**
 * Operator action on an annunciator without a host (IND-043): applied to the
 * windows and the horn, written back. Returns false when a host owns the state.
 */
export function annunciatorAction(model: AnyModel, action: "acknowledge" | "reset" | "silence"): boolean {
  const contract = contractOf(model);
  if (!contract || hostOwnsState(model)) return false;
  writePanel(model as AnyModel<Traits>, panelAction(panelOf(model, reader(model, contract)), action));
  return true;
}

/** Window states and horn of an annunciator (IND-041, IND-042): process conditions written by the host. */
function attachAnnunciator(model: AnyModel<Traits>, contract: WidgetContract): () => void {
  const read = reader(model, contract);
  const initial = normalizeWindows(read("value"));
  const sounding = initial.some((w) => w.state === "alert" || w.state === "ringback");
  // an active window still "normal" (e.g. given by a host without states) goes through the sequence
  PANELS.set(model, { silenced: sounding && !read("horn"), active: new Map(initial.map((w) => [w.tag, w.active && w.state !== "normal"])) });
  let writing = false;
  const guarded = (f: () => void) => (): void => {
    if (writing || hostOwnsState(model)) return;
    writing = true;
    try {
      f();
    } finally {
      writing = false;
    }
  };
  const onValue = guarded(() => {
    const reg = PANELS.get(model) as { silenced: boolean; active: Map<string, boolean> };
    let p = panelOf(model, read);
    // a changed (or new) process condition goes through the sequence
    for (const w of p.windows) {
      const before = reg.active.get(w.tag) ?? false;
      if (before !== w.active) {
        w.active = before;
        p = setProcess(p, w.tag, !before);
      }
    }
    writePanel(model, p);
  });
  const onSequence = guarded(() => {
    const p = panelOf(model, read);
    for (const w of p.windows) {
      w.state = w.active ? "alert" : "normal";
      w.first = false;
    }
    writePanel(model, p);
  });
  model.on("change:value", onValue);
  model.on("change:sequence", onSequence);
  onValue();
  return () => {
    model.off("change:value", onValue);
    model.off("change:sequence", onSequence);
  };
}

function writeRows(model: AnyModel<Traits>, rows: AlarmRow[]): void {
  if (JSON.stringify(model.get("value")) === JSON.stringify(rows)) return;
  model.set("value", rows);
  model.save_changes();
}

/**
 * Operator action on an alarm banner or alarm list without a host
 * (SCADA-007, IND-053): acknowledge (one or all), shelve, unshelve, applied to
 * the rows and written back. Does nothing when a host owns the state.
 */
export function alarmAction(model: AnyModel, msg: { type: string; alarm_id?: string; seconds?: number }, now = Date.now()): void {
  const contract = contractOf(model);
  if (!contract || hostOwnsState(model)) return;
  const list = contract.className === "AlarmList";
  const table = BY_KIND.alarmindicator?.traits.value.transitions;
  const rows = ((model.get("value") as AlarmRow[]) || []).map((r) => ({ ...r }));
  let next: AlarmRow[] | null = rows;
  if (msg.type === "ack") next = acknowledgeRows(rows, String(msg.alarm_id), table, list);
  else if (msg.type === "ack_all") next = acknowledgeRows(rows, null, table, list);
  else if (msg.type === "shelve") next = shelveRow(rows, String(msg.alarm_id), Number(msg.seconds), Number(reader(model, contract)("max_shelve")), now);
  else if (msg.type === "unshelve") next = unshelveRow(rows, String(msg.alarm_id));
  if (next) writeRows(model as AnyModel<Traits>, next);
}

/** Shelving expiry of an alarm list without a host (IND-051): a timer on the next expiry. */
function attachShelvingExpiry(model: AnyModel<Traits>): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const arm = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (hostOwnsState(model)) return;
    const t = nextExpiry((model.get("value") as AlarmRow[]) || []);
    if (t === null) return;
    timer = setTimeout(() => {
      timer = null;
      writeRows(model, expireShelving((model.get("value") as AlarmRow[]) || [], Date.now()).rows);
      arm();
    }, Math.max(0, t - Date.now()) + 50);
  };
  model.on("change:value", arm);
  arm();
  return () => {
    if (timer) clearTimeout(timer);
    model.off("change:value", arm);
  };
}

/**
 * Model-level hook (AFM `initialize`): keep the derived traits of a widget
 * with a schema up to date when no host owns the state. Returns a cleanup.
 */
export function attachDerived(model: AnyModel, { clock = monotonic }: { clock?: () => number } = {}): () => void {
  const contract = contractOf(model);
  const cleanups: Array<() => void> = [];
  if (contract?.traits.alarm_level?.writer === "derived") cleanups.push(attachAlarmLevel(model, contract));
  if (contract?.traits.peak?.writer === "derived") cleanups.push(attachPeak(model, contract, clock));
  if (contract?.traits.alarm_levels?.writer === "derived") cleanups.push(attachBarLevels(model, contract));
  if (contract?.traits.available_commands?.writer === "derived") cleanups.push(attachStateMachine(model, contract));
  if (contract?.traits.loop_mode && contract.traits.value?.writer === "derived") cleanups.push(attachPidSummary(model, contract));
  if (contract?.traits.horn?.writer === "derived") cleanups.push(attachAnnunciator(model, contract));
  if (contract?.traits.max_shelve) cleanups.push(attachShelvingExpiry(model));
  return () => cleanups.forEach((c) => c());
}
