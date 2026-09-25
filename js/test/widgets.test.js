import { describe, expect, it } from "vitest";
import { mechanicalTransition } from "../src/widgets/boolean.js";
import { Ring, viewWindow } from "../src/widgets/chart.js";
import { sevenSegmentText } from "../src/widgets/sevensegment.js";
import widget from "../src/index.js";
import { parseSkin } from "../src/core/dom.js";
import { common, fakeModel } from "./helpers.js";

describe("mechanical actions", () => {
  it("switch actions", () => {
    expect(mechanicalTransition("switch_when_pressed", "press", false, false)).toBe(true);
    expect(mechanicalTransition("switch_when_pressed", "release", true, false)).toBeNull();
    expect(mechanicalTransition("switch_when_released", "press", false, false)).toBeNull();
    expect(mechanicalTransition("switch_when_released", "release", false, false)).toBe(true);
    expect(mechanicalTransition("switch_until_released", "press", false, false)).toBe(true);
    expect(mechanicalTransition("switch_until_released", "release", true, false)).toBe(false);
  });
  it("latch actions set the non-default value only", () => {
    expect(mechanicalTransition("latch_when_pressed", "press", false, false)).toBe(true);
    expect(mechanicalTransition("latch_when_pressed", "release", true, false)).toBeNull();
    expect(mechanicalTransition("latch_when_released", "release", false, false)).toBe(true);
    expect(mechanicalTransition("latch_until_released", "press", true, true)).toBe(false);
  });
});

describe("waveform ring buffer", () => {
  it("keeps the latest samples", () => {
    const r = new Ring(3, 2);
    r.push(new Float32Array([1, 10, 2, 20, 3, 30, 4, 40]), 4);
    expect(r.total).toBe(4);
    expect(r.at(0, 0)).toBeNaN(); // discarded
    expect(r.at(0, 1)).toBe(2);
    expect(r.at(1, 3)).toBe(40);
  });
  it("view windows for each update mode", () => {
    expect(viewWindow("strip", 10, 4).start).toBe(6);
    expect(viewWindow("strip", 10, 4).xOf(9)).toBe(3);
    const scope = viewWindow("scope", 10, 4);
    expect(scope.start).toBe(8);
    expect(scope.xOf(9)).toBe(1);
    const sweep = viewWindow("sweep", 10, 4);
    expect(sweep.cursor).toBe(2);
    expect(sweep.xOf(9)).toBe(1);
  });
});

describe("seven segment text", () => {
  it("right aligns with decimal point", () => {
    expect(sevenSegmentText(12.34, 4, 1)).toEqual({ chars: " 123", dp: 2 });
    expect(sevenSegmentText(-5, 4, 0)).toEqual({ chars: "  -5", dp: -1 });
    expect(sevenSegmentText(123456, 4, 0).chars).toBe(" Err");
    expect(sevenSegmentText(NaN, 4, 0).chars).toBe(" NaN");
  });
});

describe("skin parsing", () => {
  it("drops scripts, handlers and external references", () => {
    const node = parseSkin('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect onclick="x()" width="5"/><image href="http://evil/x.png"/></svg>');
    expect(node.querySelector("script")).toBeNull();
    expect(node.querySelector("rect").hasAttribute("onclick")).toBe(false);
    expect(node.querySelector("image").hasAttribute("href")).toBe(false);
  });
});

/** Minimal in-memory anywidget model. */

describe("rendering", () => {
  it("renders a knob with text-only label and keyboard control", async () => {
    const model = fakeModel({ ...common, _kind: "knob", value: 50, min: 0, max: 100, step: 5, unit: "V", scale: "linear", ticks: 5, minor_ticks: 4, format: "%.1f", alarm_level: "normal", angle_range: 270, update_rate: 30 });
    const el = document.createElement("div");
    const cleanup = widget.render({ model, el });
    await new Promise((r) => setTimeout(r, 30));
    expect(el.querySelector(".awi-label").textContent).toBe("<b>Gain</b>");
    expect(el.querySelector("b")).toBeNull(); // SEC-002
    const body = el.querySelector(".awi-body");
    expect(body.getAttribute("role")).toBe("slider");
    expect(el.querySelector(".awi-value").textContent).toBe("50.0 V");
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(model.get("value")).toBe(55);
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    expect(model.get("value")).toBe(100);
    cleanup();
    expect(el.children).toHaveLength(0);
  });

  it("ignores input in indicator mode (API-004)", async () => {
    const model = fakeModel({ ...common, mode: "indicator", _kind: "gauge", value: 10, min: 0, max: 100, step: 0, unit: "", scale: "linear", ticks: 5, minor_ticks: 4, format: "%.1f", alarm_level: "hi", variant: "circular", ranges: [] });
    const el = document.createElement("div");
    widget.render({ model, el });
    await new Promise((r) => setTimeout(r, 30));
    el.querySelector(".awi-body").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(model.get("value")).toBe(10);
    expect(el.querySelector(".awi-badge").textContent).toContain("HI");
    expect(el.querySelector(".awi-body").getAttribute("role")).toBe("meter");
  });

  it("a value update only touches what changes (PERF-002)", async () => {
    const model = fakeModel({ ...common, mode: "indicator", _kind: "gauge", value: 10, min: 0, max: 100, step: 0, unit: "", scale: "linear", ticks: 5, minor_ticks: 4, format: "%.1f", alarm_level: "normal", variant: "circular", ranges: [] });
    const el = document.createElement("div");
    document.body.appendChild(el);
    widget.render({ model, el });
    await new Promise((r) => setTimeout(r, 30));
    const changed = new Set();
    const obs = new MutationObserver((ms) => ms.forEach((m) => changed.add(m.attributeName || m.target.className || m.target.parentNode?.className)));
    obs.observe(el, { subtree: true, attributes: true, childList: true, characterData: true });
    model.set("value", 20);
    model.emit("change:value");
    await new Promise((r) => setTimeout(r, 30));
    obs.takeRecords().forEach((m) => changed.add(m.attributeName || m.target.className));
    obs.disconnect();
    for (const unchanged of ["hidden", "role", "tabindex", "aria-valuemin", "aria-valuemax", "title", "awi-label"]) expect(changed).not.toContain(unchanged);
    expect(changed).toContain("aria-valuenow");
    expect(el.querySelector(".awi-body").getAttribute("aria-valuenow")).toBe("20");
    el.remove();
  });

  it("push button latch on keyboard press/release", async () => {
    const model = fakeModel({ ...common, _kind: "pushbutton", value: false, default_state: false, mechanical_action: "latch_when_released", confirm: false, text: "Go", _pressed: false });
    const el = document.createElement("div");
    widget.render({ model, el });
    await new Promise((r) => setTimeout(r, 30));
    const body = el.querySelector(".awi-body");
    body.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(model.get("value")).toBe(false);
    body.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    expect(model.get("value")).toBe(true);
  });

  it("illuminated push button shows its lamp by class, ring and description (BOOL-015)", async () => {
    const model = fakeModel({ ...common, _kind: "pushbutton", value: false, default_state: false, mechanical_action: "switch_when_pressed", confirm: false, text: "RUN", _pressed: false, color: "grey", shape: "round", lamp: false, lamp_color: "green", lamp_blink: false });
    const el = document.createElement("div");
    widget.render({ model, el });
    await new Promise((r) => setTimeout(r, 30));
    const body = el.querySelector(".awi-body");
    expect(el.querySelector("circle.awi-button").classList.contains("awi-lamp-green")).toBe(true);
    expect(el.querySelector(".awi-lit")).toBeNull();
    expect(el.querySelector(".awi-lamp-ring")).toBeNull();
    expect(body.getAttribute("aria-description")).toBe("lamp off");
    model.set("lamp", true);
    model.set("lamp_blink", true);
    model.emit("change:lamp");
    await new Promise((r) => setTimeout(r, 30));
    expect(el.querySelector(".awi-button").classList.contains("awi-lit")).toBe(true);
    expect(el.querySelector(".awi-button").classList.contains("awi-lamp-blink")).toBe(true);
    expect(el.querySelector(".awi-lamp-ring")).not.toBeNull();
    expect(body.getAttribute("aria-description")).toBe("lamp on, flashing");
    model.set("lamp", null);
    model.emit("change:lamp");
    await new Promise((r) => setTimeout(r, 30));
    expect(body.hasAttribute("aria-description")).toBe(false);
    expect(el.querySelector(".awi-button").classList.contains("awi-cap-grey")).toBe(true);
  });

  it("chart requests history and consumes binary buffers", () => {
    const model = fakeModel({ ...common, _kind: "waveformchart", mode: "indicator", history: 8, n_traces: 1, update_mode: "strip", y_min: -1, y_max: 1, autoscale_y: false, paused: false, dt: 1, x_unit: "", unit: "", traces: [], show_legend: true, size: [300, 150] });
    const el = document.createElement("div");
    widget.render({ model, el });
    expect(model.sent[0]).toEqual({ type: "sync_request" });
    const data = new Float32Array([0.5, 0.25]);
    model.emit("msg:custom", { type: "append", n_points: 2, total: 2 }, [new DataView(data.buffer)]);
  });
});

describe("stale data (ROB-001)", () => {
  it("rejects input and shows a badge when heartbeats stop", async () => {
    const model = fakeModel({ ...common, _kind: "knob", _session: "dead-session", _heartbeat: 0.001, value: 50, min: 0, max: 100, step: 5, unit: "", scale: "linear", ticks: 5, minor_ticks: 4, format: "%.1f", alarm_level: "normal", angle_range: 270, update_rate: 30 });
    const el = document.createElement("div");
    widget.render({ model, el });
    const { markDead } = await import("../src/core/liveness.js");
    markDead("dead-session");
    await new Promise((r) => setTimeout(r, 1100));
    await new Promise((r) => setTimeout(r, 30));
    expect(el.querySelector(".awi-root").classList.contains("awi-stale")).toBe(true);
    expect(el.querySelector(".awi-stale-badge").textContent).toContain("STALE");
    el.querySelector(".awi-body").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    expect(model.get("value")).toBe(50);
  });
});

describe("polar helpers", async () => {
  const { gammaToZ, screenAngle } = await import("../src/widgets/polar.js");
  it("screen angle conventions", () => {
    expect(screenAngle(90)).toBe(90);
    expect(screenAngle(90, { zero: "N", direction: "cw" })).toBe(0);
    expect(screenAngle(Math.PI, { unit: "rad" })).toBeCloseTo(180);
  });
  it("gamma to normalized impedance", () => {
    expect(gammaToZ(0, 0)).toEqual([1, 0]);
    const [r, x] = gammaToZ(0, 1); // Γ = j -> z = j
    expect(r).toBeCloseTo(0);
    expect(x).toBeCloseTo(1);
  });
});
