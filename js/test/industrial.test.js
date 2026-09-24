// Industrial operator objects (IND-*): front-end behaviour.
import { describe, expect, it } from "vitest";
import widget from "../src/index.js";
import { selectorAngle } from "../src/widgets/industrial.js";
import { common, fakeModel } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 30));

function mount(state) {
  const model = fakeModel({ ...common, ...state });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const cleanup = widget.render({ model, el });
  return { model, el, cleanup, body: el.querySelector(".awi-body") };
}

describe("SelectorSwitch (IND-010..013)", () => {
  const sel = { _kind: "selectorswitch", value: "OFF", positions: ["HAND", "OFF", "AUTO"], keyed: false, locked: false, default_position: null, spring_return: [], size: [140, 130] };

  it("spreads positions symmetrically", () => {
    expect(selectorAngle(0, 3)).toBe(-60);
    expect(selectorAngle(1, 3)).toBe(0);
    expect(selectorAngle(2, 3)).toBe(60);
    expect(selectorAngle(1, 2)).toBe(45);
  });

  it("moves with the arrow keys and reports the position through ARIA", async () => {
    const { model, body } = mount(sel);
    await tick();
    expect(body.getAttribute("aria-valuetext")).toBe("OFF");
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(model.get("value")).toBe("AUTO");
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(model.get("value")).toBe("AUTO"); // end stop
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "Home" }));
    expect(model.get("value")).toBe("HAND");
  });

  it("rejects changes while the key switch is locked (IND-012)", async () => {
    const { model, body, el } = mount({ ...sel, keyed: true, locked: true });
    await tick();
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(model.get("value")).toBe("OFF");
    expect(el.querySelector(".awi-lock-body")).not.toBeNull();
    expect(el.querySelector(".awi-value").textContent).toContain("LOCKED");
  });

  it("spring-return positions go back to the default on release (IND-013)", async () => {
    const { model, body } = mount({ ...sel, positions: ["STOP", "RUN", "START"], value: "RUN", default_position: "RUN", spring_return: ["START"] });
    await tick();
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    expect(model.get("value")).toBe("START");
    body.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowRight" }));
    expect(model.get("value")).toBe("RUN");
  });
});

describe("StackLight (IND-020..022)", () => {
  it("states each tier in text as well as color (IND-021)", async () => {
    const { el, body } = mount({ _kind: "stacklight", mode: "indicator", value: ["blink", "off", "on"], tiers: ["red", "amber", "green"], labels: ["Fault", "", "Run"], buzzer: true, size: [140, 200] });
    await tick();
    const texts = [...el.querySelectorAll(".awi-stack-text")].map((t) => t.textContent);
    expect(texts).toEqual(["♪ BUZZER", "◐ Fault: BLINK", "○ amber: OFF", "● Run: ON"]);
    expect(el.querySelectorAll(".awi-stack-blink")).toHaveLength(1);
    expect(body.getAttribute("aria-label")).toContain("Fault blink");
  });
});

describe("AnalogIndicator (IND-001..003)", () => {
  const ai = { _kind: "analogindicator", mode: "indicator", value: 50, min: 0, max: 100, step: 0, unit: "", scale: "linear", ticks: 5, minor_ticks: 0, format: "%.1f", alarm_level: "normal", lolo: null, lo: 20, hi: 80, hihi: 90, show_limits: true, orientation: "horizontal", normal_lo: 40, normal_hi: 60, target: 55, size: [240, 56] };

  it("draws the normal band, limit marks and target", async () => {
    const { el } = mount(ai);
    await tick();
    expect(el.querySelector(".awi-ai-normal")).not.toBeNull();
    expect(el.querySelectorAll(".awi-ai-limit")).toHaveLength(3);
    expect(el.querySelector(".awi-ai-target")).not.toBeNull();
    expect(el.querySelector(".awi-root").classList.contains("awi-alarm-hi")).toBe(false);
  });

  it("marks the alarm level in text (IND-002)", async () => {
    const { el } = mount({ ...ai, value: 85, alarm_level: "hi" });
    await tick();
    expect(el.querySelector(".awi-root").classList.contains("awi-alarm-hi")).toBe(true);
    expect(el.querySelector(".awi-badge").textContent).toBe("HI");
  });
});

describe("PIDFaceplate (IND-030..032)", () => {
  const fp = { _kind: "pidfaceplate", value: {}, tag: "TIC-1", unit: "°C", op_unit: "%", format: "%.1f", pv: 50, sp: 60, op: 40, loop_mode: "AUTO", modes: ["MAN", "AUTO"], pv_min: 0, pv_max: 100, sp_min: null, sp_max: null, op_min: 0, op_max: 100, confirm_delta: 10, sp_tracking: false, lolo: null, lo: null, hi: 90, hihi: null, alarm_level: "normal", size: [240, 236] };

  it("entry rules: mode, clamping and confirmation", async () => {
    const { entryDecision } = await import("../src/widgets/pid.js");
    const base = { mode: "AUTO", current: 60, min: 0, max: 100, confirmDelta: 10 };
    expect(entryDecision({ ...base, field: "op", value: 50 }).ok).toBe(false);
    expect(entryDecision({ ...base, field: "sp", value: 65 })).toEqual({ ok: true, value: 65, confirm: false });
    expect(entryDecision({ ...base, field: "sp", value: 150 })).toEqual({ ok: true, value: 100, confirm: true });
    expect(entryDecision({ ...base, field: "sp", value: Number.NaN }).ok).toBe(false);
  });

  it("sends SP entries, with a confirmation step for large changes", async () => {
    const { el, model } = mount(fp);
    await tick();
    const [spInput, opInput] = el.querySelectorAll(".awi-pid-input");
    expect(spInput.hidden).toBe(false);
    expect(opInput.hidden).toBe(true); // AUTO: OP not editable
    spInput.value = "65";
    spInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.sent.at(-1)).toEqual({ type: "set", field: "sp", value: 65, confirmed: false });
    spInput.value = "95";
    spInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(el.querySelector(".awi-pid-note").textContent).toContain("Change SP 60.0 → 95.0?");
    el.querySelector(".awi-pid-confirm").click();
    expect(model.sent.at(-1)).toEqual({ type: "set", field: "sp", value: 95, confirmed: true });
  });

  it("shows the mode as pressed text buttons and requests mode changes", async () => {
    const { el, model } = mount(fp);
    await tick();
    const buttons = [...el.querySelectorAll(".awi-pid-mode")];
    expect(buttons.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([["MAN", "false"], ["AUTO", "true"]]);
    buttons[0].click();
    expect(model.sent.at(-1)).toEqual({ type: "loop_mode", mode: "MAN" });
  });

  it("displays kernel rejections", async () => {
    const { el, model } = mount(fp);
    await tick();
    model.emit("msg:custom", { type: "rejected", field: "sp", reason: "confirmation required" });
    expect(el.querySelector(".awi-pid-note").textContent).toBe("✖ confirmation required");
  });
});

describe("Annunciator (IND-040..043)", () => {
  const windows = [
    { tag: "PAH-1", text: "Pressure high", color: "red", active: true, state: "alert", first: true },
    { tag: "LAL-2", text: "Level low", color: "amber", active: false, state: "ringback", first: false },
    { tag: "XA-3", text: "Fault", color: "amber", active: false, state: "normal", first: false },
  ];
  const ann = { _kind: "annunciator", value: windows, columns: 3, sequence: "R", first_out: true, horn: true, test: false, size: [420, 170] };

  it("states each window in text: first out, alarm, ringback", async () => {
    const { el } = mount(ann);
    await tick();
    const status = [...el.querySelectorAll(".awi-ann-status")].map((s) => s.textContent);
    expect(status).toEqual(["1ST · ALARM", "RINGBACK", ""]);
    expect(el.querySelector(".awi-ann-horn").textContent).toBe("♪ HORN");
    expect(el.querySelector(".awi-ann-first")).not.toBeNull();
  });

  it("sends operator actions, TEST while held", async () => {
    const { el, model } = mount(ann);
    await tick();
    el.querySelector(".awi-ann-acknowledge").click();
    expect(model.sent.at(-1)).toEqual({ type: "acknowledge" });
    const test = el.querySelector(".awi-ann-test");
    test.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    expect(model.sent.at(-1)).toEqual({ type: "test", on: true });
    test.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
    expect(model.sent.at(-1)).toEqual({ type: "test", on: false });
  });

  it("hides Reset for sequence A without first out", async () => {
    const { el } = mount({ ...ann, sequence: "A", first_out: false });
    await tick();
    expect(el.querySelector(".awi-ann-reset").hidden).toBe(true);
  });
});

describe("AlarmList (IND-050..053)", async () => {
  const { filterAlarms, category } = await import("../src/widgets/alarmlist.js");
  const alarms = [
    { id: "A", timestamp: "2026-01-01T10:00:00", source: "TI-1", priority: "low", message: "temp", state: "active_unacknowledged", shelved_until: null, suppressed: false, out_of_service: false },
    { id: "B", timestamp: "2026-01-01T10:05:00", source: "PI-2", priority: "critical", message: "pressure", state: "active_acknowledged", shelved_until: null, suppressed: false, out_of_service: false },
    { id: "C", timestamp: "2026-01-01T10:06:00", source: "FI-3", priority: "high", message: "flow", state: "active_unacknowledged", shelved_until: "2026-01-01T11:00:00", suppressed: false, out_of_service: false },
    { id: "D", timestamp: "", source: "LI-4", priority: "medium", message: "level", state: "normal", shelved_until: null, suppressed: true, out_of_service: false },
  ];

  it("categorises and filters (IND-050..052)", () => {
    expect(alarms.map(category)).toEqual(["active", "active", "shelved", "suppressed"]);
    expect(filterAlarms(alarms).map((a) => a.id)).toEqual(["A", "B"]); // unacknowledged first
    expect(filterAlarms(alarms, { sort: "time" }).map((a) => a.id)).toEqual(["B", "A"]);
    expect(filterAlarms(alarms, { view: "shelved" }).map((a) => a.id)).toEqual(["C"]);
    expect(filterAlarms(alarms, { view: "suppressed" }).map((a) => a.id)).toEqual(["D"]);
    expect(filterAlarms(alarms, { view: "all", priority: "critical" }).map((a) => a.id)).toEqual(["B"]);
    expect(filterAlarms(alarms, { view: "all", text: "FLOW" }).map((a) => a.id)).toEqual(["C"]);
    expect(filterAlarms(alarms, { view: "unack" }).map((a) => a.id)).toEqual(["A"]);
  });

  it("acknowledges and shelves from the table (IND-053)", async () => {
    const { el, model } = mount({ _kind: "alarmlist", value: alarms, shelve_durations: [300, 3600], max_shelve: 28800, size: [640, 240] });
    await tick();
    expect(el.querySelector(".awi-al-counts").textContent).toBe("2 active · 1 unacknowledged · 1 shelved · 1 suppressed / OOS");
    el.querySelector('button[aria-label="Acknowledge A"]').click();
    expect(model.sent.at(-1)).toEqual({ type: "ack", alarm_id: "A" });
    const shelve = el.querySelector('select[aria-label="Shelve B"]');
    expect([...shelve.options].map((o) => o.textContent)).toEqual(["Shelve…", "5 min", "1 h"]);
    shelve.value = "3600";
    shelve.dispatchEvent(new Event("change"));
    expect(model.sent.at(-1)).toEqual({ type: "shelve", alarm_id: "B", seconds: 3600 });
  });
});

describe("StateMachine (IND-060..063)", () => {
  const machine = {
    states: [{ name: "Off", x: 0, y: 0, acting: false }, { name: "Warming", x: 1, y: 0, acting: true }, { name: "Ready", x: 2, y: 0, acting: false }],
    transitions: [["Off", "On", "Warming"], ["Warming", "SC", "Ready"], ["Ready", "Off", "Off"]],
    commands: ["On", "Off"],
    initial: "Off",
  };

  it("edge points lie on the box border", async () => {
    const { boxEdge } = await import("../src/widgets/statemachine.js");
    expect(boxEdge(0, 0, 100, 0, 40, 20)).toEqual([80, 0]);
    expect(boxEdge(100, 100, 100, 0, 40, 20)).toEqual([100, 10]);
  });

  it("highlights the current state and enables only valid commands (IND-061)", async () => {
    const { el, model } = mount({ _kind: "statemachine", _session: "kernel", value: "Off", machine, available_commands: ["On"], last_command: "", size: [400, 200] });
    await tick();
    expect(el.querySelector(".awi-sm-label-current").textContent).toBe("▶ Off");
    const [on, off] = el.querySelectorAll(".awi-sm-cmd");
    expect(on.disabled).toBe(false);
    expect(off.disabled).toBe(true);
    expect(off.getAttribute("aria-disabled")).toBe("true");
    on.click();
    expect(model.sent.at(-1)).toEqual({ type: "command", command: "On" });
    expect(el.querySelectorAll(".awi-sm-acting")).toHaveLength(1);
  });
});
