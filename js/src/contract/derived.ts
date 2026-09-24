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
import { coerceValue } from "./numeric.js";
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

/**
 * Model-level hook (AFM `initialize`): keep the derived traits of a widget
 * with a schema up to date when no host owns the state. Returns a cleanup.
 */
export function attachDerived(model: AnyModel): () => void {
  const contract = contractOf(model);
  const cleanups: Array<() => void> = [];
  if (contract?.traits.alarm_level?.writer === "derived") cleanups.push(attachAlarmLevel(model, contract));
  return () => cleanups.forEach((c) => c());
}
