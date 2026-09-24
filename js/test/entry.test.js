// Two ways of setting a value (API-014): form entry of numbers (NUM-010).
import { describe, expect, it } from "vitest";
import { checkEntry } from "../src/core/entry.js";
import { parseEntry } from "../src/core/format.js";
import widget from "../src/index.js";
import { common, fakeModel } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 30));

function mount(state) {
  const model = fakeModel({ ...common, ...state });
  const el = document.createElement("div");
  document.body.appendChild(el);
  widget.render({ model, el });
  return { model, el };
}

const KNOB = { _kind: "knob", value: 50, min: 0, max: 100, step: 5, unit: "V", scale: "linear", ticks: 5, minor_ticks: 4, format: "%.1f", alarm_level: "normal", angle_range: 270, update_rate: 30, entry: true, coerce: false };

describe("parseEntry", () => {
  it("reads decimals, exponents, SI prefixes and a trailing unit", () => {
    expect(parseEntry("12.5")).toBe(12.5);
    expect(parseEntry(" 2,5 ")).toBe(2.5);
    expect(parseEntry("1e3")).toBe(1000);
    expect(parseEntry("4.7k")).toBe(4700);
    expect(parseEntry("250 mV", "V")).toBeCloseTo(0.25);
    expect(parseEntry("-3 V", "V")).toBe(-3);
    expect(parseEntry("12 µ")).toBeCloseTo(12e-6);
    expect(parseEntry("abc")).toBeNaN();
    expect(parseEntry("")).toBeNaN();
    expect(parseEntry("1..2")).toBeNaN();
  });
});

describe("checkEntry (NUM-010)", () => {
  const scale = { min: 0, max: 10, step: 0.5, unit: "bar" };
  it("snaps valid entries to the step", () => {
    expect(checkEntry("3.3", scale)).toEqual({ ok: true, value: 3.5 });
  });
  it("rejects out-of-range entries with the range in the message", () => {
    const r = checkEntry("12", scale);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("Out of range: enter a value between 0.0 bar … 10.0 bar");
    expect(checkEntry("x", scale).reason).toMatch(/^Not a number/);
  });
  it("clamps instead when coerce is set", () => {
    expect(checkEntry("12", { ...scale, coerce: true })).toEqual({ ok: true, value: 10 });
  });
});

describe("numeric entry field", () => {
  it("shows the value and commits a typed entry", async () => {
    const { el, model } = mount(KNOB);
    await tick();
    const field = el.querySelector(".awi-entry");
    expect(field.hidden).toBe(false);
    expect(field.value).toBe("50.0");
    expect(el.querySelector(".awi-entry-unit").textContent).toBe("V");
    field.value = "72";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.get("value")).toBe(70); // snapped to step 5
  });

  it("rejects an out-of-range entry and keeps the value", async () => {
    const { el, model } = mount(KNOB);
    await tick();
    const field = el.querySelector(".awi-entry");
    field.value = "150";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.get("value")).toBe(50);
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(el.querySelector(".awi-entry-msg").textContent).toContain("0.0 V … 100.0 V");
    field.value = "40";
    field.dispatchEvent(new Event("input"));
    expect(el.querySelector(".awi-entry-msg").hidden).toBe(true);
  });

  it("Escape restores the value; indicators and entry=False have no field", async () => {
    const { el } = mount(KNOB);
    await tick();
    const field = el.querySelector(".awi-entry");
    field.value = "9";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(field.value).toBe("50.0");
    const gauge = mount({ ...KNOB, _kind: "gauge", mode: "indicator", variant: "circular", ranges: [] });
    await tick();
    expect(gauge.el.querySelector(".awi-entry").hidden).toBe(true);
    const bare = mount({ ...KNOB, entry: false });
    await tick();
    expect(bare.el.querySelector(".awi-entry").hidden).toBe(true);
  });
});

describe("selector list, valve position, cursor fields (API-014)", () => {
  it("SelectorSwitch offers its positions as a list", async () => {
    const { el, model } = mount({ _kind: "selectorswitch", value: "OFF", positions: ["HAND", "OFF", "AUTO"], keyed: false, locked: false, default_position: null, spring_return: [], size: [140, 130] });
    await tick();
    const list = el.querySelector(".awi-choice");
    expect([...list.options].map((o) => o.value)).toEqual(["HAND", "OFF", "AUTO"]);
    list.value = "AUTO";
    list.dispatchEvent(new Event("change"));
    expect(model.get("value")).toBe("AUTO");
  });

  it("control valve faceplate takes a position demand, in manual only", async () => {
    const { el, model } = mount({ _kind: "valve", value: "open", position: 40, orientation: "horizontal", tag: "XV-1", auto: false, simulate: false, commands: ["open", "close"], animate: false, direction: "right", size: [90, 90] });
    await tick();
    el.querySelector(".awi-body").click();
    await tick();
    const field = el.querySelector(".awi-fp-position .awi-entry");
    expect(field.value).toBe("40");
    field.value = "120";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.sent.filter((m) => m.command === "position")).toHaveLength(0);
    field.value = "65";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.sent.at(-1)).toEqual({ type: "command", command: "position", value: 65 });
    const slider = el.querySelector(".awi-fp-slider");
    slider.value = "30";
    slider.dispatchEvent(new Event("change"));
    expect(model.sent.at(-1)).toEqual({ type: "command", command: "position", value: 30 });
  });

  it("graph cursors can be placed by typing their position", async () => {
    const { el, model } = mount({ _kind: "waveformchart", mode: "indicator", history: 100, n_traces: 1, update_mode: "strip", y_min: -1, y_max: 1, autoscale_y: false, paused: false, dt: 0.1, x_unit: "s", unit: "", traces: [], show_legend: true, cursors: [{ x: 2, name: "C1", color: "" }], cursor_values: [], annotations: [], export: true, size: [300, 150] });
    model.emit("msg:custom", { type: "append", n_points: 2, total: 2 }, [new DataView(new Float32Array([0.1, 0.2]).buffer)]);
    await tick();
    const field = el.querySelector(".awi-cursor-bar .awi-entry");
    expect(field.value).toBe("2");
    field.value = "4.5"; // strip window: -9.8 s … 0.2 s
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.get("cursors")[0].x).toBe(2);
    expect(field.getAttribute("aria-invalid")).not.toBeNull();
    field.value = "-3.5";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.get("cursors")[0].x).toBe(-3.5);
  });
});

describe("axis ranges (CHART-108)", () => {
  const CHART = { _kind: "waveformchart", mode: "indicator", history: 100, n_traces: 1, update_mode: "strip", y_min: -1, y_max: 1, autoscale_y: false, paused: false, dt: 0.1, x_unit: "s", unit: "V", traces: [], show_legend: true, cursors: [], cursor_values: [], annotations: [], export: true, size: [300, 150] };

  it("typed Y limits become the chart setting; bad limits are rejected", async () => {
    const { el, model } = mount(CHART);
    model.emit("msg:custom", { type: "append", n_points: 2, total: 2 }, [new DataView(new Float32Array([0.1, 0.2]).buffer)]);
    await tick();
    el.querySelector('button[aria-label="Set the axis ranges"]').click();
    const field = (name) => el.querySelector(`input[aria-label="${name}"]`);
    field("Y minimum").value = "5";
    field("Y maximum").value = "2";
    field("Y maximum").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(el.querySelector(".awi-axes-panel .awi-entry-msg").textContent).toBe("Y: the minimum must be below the maximum");
    expect(model.get("y_min")).toBe(-1);
    field("Y minimum").value = "-250 mV";
    field("Y maximum").value = "2";
    field("Y maximum").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect([model.get("y_min"), model.get("y_max"), model.get("autoscale_y")]).toEqual([-0.25, 2, false]);
    el.querySelector(".awi-axes-panel button:last-of-type").click(); // Auto
    expect(model.get("autoscale_y")).toBe(true);
  });

  it("PolarPlot radial range: typed maximum and Auto", async () => {
    const { el, model } = mount({ _kind: "polar", mode: "indicator", value: [{ name: "p", color: "", style: "line", r: [1, 2], theta: [0, 90] }], show_legend: true, angle_unit: "deg", zero: "E", direction: "ccw", r_max: null, rings: 4, unit: "", size: [220, 220] });
    await tick();
    const field = el.querySelector('input[aria-label="Radial range maximum"]');
    expect(field.value).toBe("2");
    field.value = "-1";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.get("r_max")).toBe(null);
    field.value = "5";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.get("r_max")).toBe(5);
  });
});
