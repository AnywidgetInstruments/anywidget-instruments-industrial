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
import { barLevels, normalizeBars } from "./bars.js";
import { coerceValue } from "./numeric.js";
import { nextPeak, type PeakState } from "./peak.js";
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

const ALARM_INPUTS = ["value", "min", "max", "coerce", "lolo", "lo", "hi", "hihi", "deadband", "alarm_level", "_session"];

/** alarm_level of a numeric widget (ALARM-002, ALARM-003). */
function attachAlarmLevel(model: AnyModel<Traits>, contract: WidgetContract): () => void {
  const read = reader(model, contract);
  const num = (name: string): number | null => read(name) as number | null;
  let previous = read("alarm_level") as AlarmLevel;
  let writing = false;
  const update = (): void => {
    if (writing) return;
    if (hostOwnsState(model)) {
      previous = read("alarm_level") as AlarmLevel;
      return;
    }
    const value = coerceValue(num("value") as number, num("min") as number, num("max") as number, !!read("coerce"));
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
  return () => cleanups.forEach((c) => c());
}
