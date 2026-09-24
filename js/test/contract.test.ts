// Trait contract runtime (HOST-001 .. HOST-004): schema-driven reading,
// derived traits and who owns them.
import { describe, expect, test, vi } from "vitest";
import { attachDerived, hostOwnsState } from "../src/contract/derived.js";
import { ScaleGuard } from "../src/contract/numeric.js";
import type { TraitSpec } from "../src/contract/spec.js";
import { defaultOf, readTrait, readValue } from "../src/contract/traits.js";
import { announcedInterval, liveness } from "../src/core/liveness.js";
import type { AnyModel } from "../src/core/model.js";
import { BY_KIND, CONTRACTS } from "../src/generated/contract.js";
// @ts-expect-error: JavaScript test helper
import { fakeModel } from "./helpers.js";

const knob = CONTRACTS.Knob.traits;
const tank = CONTRACTS.Tank.traits;

describe("generated contract", () => {
  test("concrete widgets by kind, bases flattened in", () => {
    expect(BY_KIND.knob.className).toBe("Knob");
    expect(BY_KIND.tank.className).toBe("Tank");
    expect(knob.mode.default).toBe("control");
    expect(tank.mode.default).toBe("indicator");
    expect(tank.size.default).toEqual([120, 200]);
    expect(knob.alarm_level.writer).toBe("derived");
    expect(knob._heartbeat.default).toBe(0);
    expect(knob._session.default).toBe("");
  });
});

describe("readTrait", () => {
  test("wrong types fall back to the default", () => {
    const onInvalid = vi.fn();
    expect(readTrait(knob.min, "10", onInvalid)).toBe(0);
    expect(readTrait(knob.mode, "dial", onInvalid)).toBe("control");
    expect(readTrait(knob.coerce, 1, onInvalid)).toBe(false);
    expect(readTrait(knob.size, [100], onInvalid)).toEqual([160, 160]);
    expect(readTrait(knob.hi, "high", onInvalid)).toBe(null);
    expect(onInvalid).toHaveBeenCalledTimes(5);
  });
  test("missing traits read as the default", () => {
    expect(readTrait(knob.angle_range, undefined)).toBe(270);
    expect(readTrait(tank.markers, undefined)).toEqual([]);
    expect(Number.isNaN(readTrait({ ...knob.value, default: "nan" }, undefined))).toBe(true);
  });
  test("numbers are clamped to the schema bounds", () => {
    expect(readTrait(knob.angle_range, 400)).toBe(360);
    expect(readTrait(knob.angle_range, 1)).toBe(10);
    expect(readTrait(knob.ticks, 0)).toBe(1);
    expect(readTrait(knob.ticks, 4.6)).toBe(5);
    expect(readTrait(knob.animation_ms, 1000)).toBe(300);
    expect(readTrait(knob.deadband, -1)).toBe(0);
    expect(readTrait(knob.update_rate, 0)).toBe(1);
    expect(readTrait(knob._heartbeat, -2)).toBe(0);
  });
  test("non-finite floats only where the schema allows them", () => {
    expect(readTrait(knob.value, "nan")).toBeNaN();
    expect(readTrait(knob.value, "inf")).toBe(Infinity);
    expect(readTrait(knob.value, NaN)).toBeNaN();
    expect(readTrait(knob.min, "nan")).toBe(0);
    expect(readTrait(knob.min, Infinity)).toBe(0);
  });
  test("nullable limits", () => {
    expect(readTrait(knob.hi, null)).toBe(null);
    expect(readTrait(knob.hi, 80)).toBe(80);
    expect(readTrait(knob.min, null)).toBe(0);
  });
  test("arrays keep their valid items; tuples need all", () => {
    expect(readTrait(tank.markers, [1, "x", 2, null])).toEqual([1, 2]);
    expect(readTrait(knob.size, [200, 0])).toEqual([160, 160]);
    expect(readTrait(knob.size, [200.4, 100])).toEqual([200, 100]);
  });
  test("objects keep the known keys with string values", () => {
    expect(readTrait(knob.skin, { knob: "<svg/>", foo: "<svg/>", needle: 3 })).toEqual({ knob: "<svg/>" });
    expect(readTrait(knob.skin, "x")).toEqual({});
  });
  test("readValue and defaultOf", () => {
    const spec: TraitSpec = { type: "number", default: "nan", writer: "host", nonfinite: true };
    expect(defaultOf(spec)).toBeNaN();
    expect(readValue({ type: "any" }, { a: 1 })).toEqual({ a: 1 });
  });
});

describe("ScaleGuard", () => {
  test("keeps the last valid scale and warns once", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = new ScaleGuard();
    expect(g.resolve({ min: 0, max: 10, scale: "linear" })).toEqual({ min: 0, max: 10, scale: "linear" });
    expect(g.resolve({ min: 10, max: 10, scale: "linear" })).toEqual({ min: 0, max: 10, scale: "linear" });
    expect(g.resolve({ min: 0, max: 5, scale: "log" })).toEqual({ min: 0, max: 10, scale: "linear" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(g.resolve({ min: 1, max: 5, scale: "log" })).toEqual({ min: 1, max: 5, scale: "log" });
    warn.mockRestore();
  });
  test("falls back to the default scale", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(new ScaleGuard().resolve({ min: 5, max: 1, scale: "linear" })).toEqual({ min: 0, max: 100, scale: "linear" });
    warn.mockRestore();
  });
});

describe("liveness announcement (HOST-003)", () => {
  test("off unless a session and a period are announced", () => {
    expect(announcedInterval(undefined, undefined)).toBe(0);
    expect(announcedInterval("", 2)).toBe(0);
    expect(announcedInterval("abc", 0)).toBe(0);
    expect(announcedInterval("abc", "2")).toBe(2);
    expect(announcedInterval("abc", 2)).toBe(2);
  });
  test("a host that announces nothing is never stale", () => {
    const since = 0;
    expect(liveness({ session: "", interval: 0, since, now: 1e9 })).toBe("live");
    expect(liveness({ session: undefined, interval: undefined, since, now: 1e9 })).toBe("live");
    expect(liveness({ session: "never-beating", interval: 2, since, now: 1e9 })).toBe("nokernel");
  });
});

/** Model whose `set` fires change events, like the AFM hosts. */
function eventModel(state: Record<string, unknown>): AnyModel & { sent: unknown[] } {
  const m = fakeModel(state);
  const set = m.set;
  m.set = (k: string, v: unknown) => {
    set(k, v);
    m.emit(`change:${k}`);
  };
  return m;
}

describe("derived alarm_level (HOST-004)", () => {
  test("hostOwnsState", () => {
    expect(hostOwnsState(eventModel({ _session: "" }))).toBe(false);
    expect(hostOwnsState(eventModel({}))).toBe(false);
    expect(hostOwnsState(eventModel({ _session: "k1" }))).toBe(true);
  });

  test("without a host, the front end computes it and writes it back", () => {
    const m = eventModel({ _kind: "tank", value: 1, hi: 3, hihi: 3.5, deadband: 0.2 });
    const detach = attachDerived(m);
    expect(m.get("alarm_level")).toBe("normal");
    m.set("value", 3.2);
    expect(m.get("alarm_level")).toBe("hi");
    expect(m.sent.at(-1)).toMatchObject({ alarm_level: "hi" });
    m.set("value", 2.9); // inside the deadband
    expect(m.get("alarm_level")).toBe("hi");
    m.set("value", 2.7);
    expect(m.get("alarm_level")).toBe("normal");
    m.set("hihi", 2.5); // a limit change is applied at once
    expect(m.get("alarm_level")).toBe("hihi");
    detach();
    m.set("value", 0);
    expect(m.get("alarm_level")).toBe("hihi");
  });

  test("the coerced value decides, as in the kernel", () => {
    const m = eventModel({ _kind: "knob", value: 150, max: 100, hi: 120, coerce: true });
    attachDerived(m);
    expect(m.get("alarm_level")).toBe("normal");
    m.set("coerce", false);
    expect(m.get("alarm_level")).toBe("hi");
  });

  test("the previous level is seeded from the trait (saved state)", () => {
    const m = eventModel({ _kind: "knob", value: 79, hi: 80, deadband: 2, alarm_level: "hi" });
    attachDerived(m);
    expect(m.get("alarm_level")).toBe("hi");
  });

  test("with a host owning the state, the host value is kept", () => {
    const m = eventModel({ _kind: "knob", _session: "kernel", value: 95, hi: 80, alarm_level: "normal" });
    attachDerived(m);
    m.set("value", 99);
    expect(m.get("alarm_level")).toBe("normal");
    expect(m.sent).toHaveLength(0);
  });

  test("widgets without a schema are left alone", () => {
    const m = eventModel({ _kind: "not-a-widget", value: 95, hi: 80 });
    attachDerived(m);
    expect(m.get("alarm_level")).toBeUndefined();
  });
});

describe("derived peak (HOST-004, NUM-110)", () => {
  test("without a host, the front end holds the peak with the kernel rules", () => {
    let now = 100;
    const m = eventModel({ _kind: "gauge", value: 10, peak_hold: true, peak_decay: 2, peak: null });
    attachDerived(m, { clock: () => now });
    m.set("value", 80);
    expect(m.get("peak")).toBe(80);
    now = 101;
    m.set("value", 60);
    expect(m.get("peak")).toBe(80);
    now = 102.5; // older than peak_decay: released at this value
    m.set("value", 50);
    expect(m.get("peak")).toBe(50);
    m.set("peak", null); // reset by the host
    now = 103;
    m.set("value", 40);
    expect(m.get("peak")).toBe(40);
    expect(m.sent.at(-1)).toMatchObject({ peak: 40 });
  });

  test("off unless peak_hold; kept when a host owns the state", () => {
    const off = eventModel({ _kind: "meter", value: 10, peak: null });
    attachDerived(off);
    off.set("value", 90);
    expect(off.get("peak")).toBe(null);
    const host = eventModel({ _kind: "vumeter", _session: "k", value: 10, peak_hold: true, peak: 20 });
    attachDerived(host);
    host.set("value", 90);
    expect(host.get("peak")).toBe(20);
  });
});

describe("transitions", () => {
  test("applyTransition follows the table and keeps the state otherwise", async () => {
    const { applyTransition } = await import("../src/contract/transitions.js");
    const table = CONTRACTS.AlarmIndicator.traits.value.transitions;
    expect(applyTransition(table, "active_unacknowledged", "acknowledge")).toBe("active_acknowledged");
    expect(applyTransition(table, "normal", "acknowledge")).toBe("normal");
    expect(applyTransition(undefined, "x", "y")).toBe("x");
  });
});
