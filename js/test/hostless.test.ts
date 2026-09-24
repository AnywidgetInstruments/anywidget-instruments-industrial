// Knob and Tank without a Python kernel (HOST-001 .. HOST-004): the model is
// a plain dictionary of traits, as a host such as KaimonSlate.jl builds it
// from the class defaults and the traits given by the user.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import widget from "../src/index.js";
import { CONTRACTS } from "../src/generated/contract.js";

type State = Record<string, unknown>;

/** AFM model over a trait dictionary: set fires change events, save_changes sends the dictionary. */
function hostModel(state: State) {
  const traits: State = { ...state };
  const handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
  const saved: State[] = [];
  const fire = (ev: string, ...args: unknown[]) => (handlers[ev] || []).slice().forEach((h) => h(...args));
  return {
    saved,
    get: (k: string) => traits[k],
    set: (k: string, v: unknown) => {
      if (JSON.stringify(traits[k]) === JSON.stringify(v)) return;
      traits[k] = v;
      fire(`change:${k}`);
    },
    save_changes: () => saved.push({ ...traits }),
    on: (ev: string, cb: (...a: unknown[]) => void) => (handlers[ev] ||= []).push(cb),
    off: (ev: string, cb: (...a: unknown[]) => void) => {
      handlers[ev] = (handlers[ev] || []).filter((h) => h !== cb);
    },
    send: (_content: unknown): void => {},
    /** A custom message sent by the host (msg:custom, with buffers). */
    fireMsg: (content: unknown, buffers: ArrayBuffer[]) => fire("msg:custom", content, buffers),
    /** A value pushed by the host (e.g. a Julia cell re-run). */
    push(k: string, v: unknown) {
      traits[k] = v;
      fire(`change:${k}`);
    },
  };
}

/** Class defaults as a host reads them (schema defaults), plus the user's traits. */
function defaults(title: keyof typeof CONTRACTS): State {
  return Object.fromEntries(Object.entries(CONTRACTS[title].traits).map(([k, s]) => [k, s.default]));
}

function mount(state: State) {
  const model = hostModel(state);
  const el = document.createElement("div");
  document.body.appendChild(el);
  const cleanupModel = widget.initialize({ model });
  const cleanupView = widget.render({ model, el });
  const root = el.querySelector(".awi-root") as HTMLElement;
  const body = el.querySelector(".awi-body") as HTMLElement;
  return { model, el, root, body, cleanup: () => { cleanupView?.(); cleanupModel?.(); } };
}

const frame = () => vi.advanceTimersByTimeAsync(40);

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.textContent = "";
});

describe("Knob without a kernel", () => {
  test("bounds its value, shows its alarm and never NO KERNEL", async () => {
    const { model, root, body } = mount({ ...defaults("Knob"), value: 150, coerce: true, hi: 90, label: "Gain" });
    await frame();
    // coerce: shown clamped to max, as the kernel would store it
    expect(body.getAttribute("aria-valuenow")).toBe("100");
    // derived alarm_level computed by the front end and written back
    expect(model.get("alarm_level")).toBe("hi");
    expect(model.saved.at(-1)).toMatchObject({ alarm_level: "hi" });
    expect(root.classList.contains("awi-alarm-hi")).toBe(true);
    expect(root.querySelector(".awi-badge")?.textContent).toContain("HI");
    // no heartbeat announced: never stale, however long we wait
    await vi.advanceTimersByTimeAsync(60_000);
    expect(root.classList.contains("awi-stale")).toBe(false);
    expect((root.querySelector(".awi-stale-badge") as HTMLElement).hidden).toBe(true);
  });

  test("a value pushed by the host updates the alarm with hysteresis", async () => {
    const { model, root } = mount({ ...defaults("Knob"), value: 10, hi: 80, deadband: 5 });
    await frame();
    model.push("value", 85);
    await frame();
    expect(root.classList.contains("awi-alarm-hi")).toBe(true);
    model.push("value", 77);
    await frame();
    expect(model.get("alarm_level")).toBe("hi");
    model.push("value", 70);
    await frame();
    expect(model.get("alarm_level")).toBe("normal");
    expect(root.classList.contains("awi-alarm-hi")).toBe(false);
  });

  test("user input is snapped and bounded", async () => {
    const { model, body } = mount({ ...defaults("Knob"), value: 50, step: 5 });
    await frame();
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(model.get("value")).toBe(100);
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    expect(model.get("value")).toBe(100);
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(model.get("value")).toBe(95);
  });

  test("invalid traits fall back to the schema", async () => {
    const { body, root } = mount({ ...defaults("Knob"), value: "nan", mode: "bogus", angle_range: 720, min: 10, max: 0 });
    await frame();
    expect(body.getAttribute("role")).toBe("slider"); // mode -> "control"
    expect(root.classList.contains("awi-invalid")).toBe(true); // NaN value (NUM-007)
    expect(body.getAttribute("aria-valuemin")).toBe("0"); // invalid scale -> last valid (defaults)
    expect(body.getAttribute("aria-valuemax")).toBe("100");
    expect(console.warn).toHaveBeenCalled();
  });

  test("only the traits the user gave: a minimal dictionary works", async () => {
    const { body, root } = mount({ _kind: "knob", value: 30 });
    await frame();
    expect(body.getAttribute("aria-valuenow")).toBe("30");
    expect(body.getAttribute("aria-valuemax")).toBe("100");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(root.classList.contains("awi-stale")).toBe(false);
  });
});

// Every migrated numeric widget: bounded value, derived alarm, no NO KERNEL.
const NUMERIC = [
  ["Knob", 100],
  ["Dial", 100],
  ["Tank", 100],
  ["Thermometer", 120],
  ["FillSlide", 100],
  ["SevenSegment", 1e9],
  ["AnalogIndicator", 100],
  ["Transmitter", 100],
  ["Gauge", 100],
  ["Meter", 100],
  ["VUMeter", 100],
] as const;

describe.each(NUMERIC)("%s without a kernel", (title, max) => {
  test("bounds its value and shows its alarm, without NO KERNEL", async () => {
    const { model, root, body } = mount({ ...defaults(title), value: max * 2, coerce: true, hi: max / 2, label: title });
    await frame();
    expect(body.getAttribute("aria-valuenow")).toBe(String(max));
    expect(model.get("alarm_level")).toBe("hi");
    expect(root.classList.contains("awi-alarm-hi")).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(root.classList.contains("awi-stale")).toBe(false);
  });
});

describe("Compass without a kernel", () => {
  test("wraps the heading as the kernel does", async () => {
    const { model, body } = mount({ ...defaults("Compass"), value: -90, label: "Heading" });
    await frame();
    expect(body.getAttribute("aria-valuenow")).toBe("270");
    model.push("value", 725);
    await frame();
    expect(body.getAttribute("aria-valuenow")).toBe("5");
  });
});

describe("NumericEntry without a kernel", () => {
  test("keypad entries are range checked and sent to the host", async () => {
    const { model, el } = mount({ ...defaults("NumericEntry"), value: 1, max: 4, label: "Setpoint" });
    await frame();
    const key = (name: string) => (el.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement).click();
    key("9");
    key("Enter");
    expect(el.querySelector(".awi-kp-msg")?.textContent).toContain("Out of range");
    expect(model.get("value")).toBe(1);
    key("Clear the entry");
    key("3");
    key("Enter");
    expect(model.get("value")).toBe(3);
    expect(model.saved.at(-1)).toMatchObject({ value: 3 });
  });
});

describe("Transmitter without a kernel", () => {
  test("an unknown status reads as the schema default", async () => {
    const { root } = mount({ ...defaults("Transmitter"), value: 2, tag: "LT-101", status: "broken" });
    await frame();
    expect(root.classList.contains("awi-ne107-ok")).toBe(true);
  });
});

describe("Gauge without a kernel", () => {
  test("holds its peak and draws the marker", async () => {
    const { model, el } = mount({ ...defaults("Gauge"), value: 10, peak_hold: true, label: "Pressure" });
    await frame();
    model.push("value", 90);
    model.push("value", 40);
    await frame();
    expect(model.get("peak")).toBe(90);
    expect((el.querySelector(".awi-peak") as SVGElement).style.display).toBe("");
  });
});

describe("Boolean widgets without a kernel", () => {
  const press = (body: HTMLElement) => {
    body.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    body.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
  };

  test("an LED is an indicator by default and never stale", async () => {
    const { root, body } = mount({ ...defaults("LED"), value: true, label: "Run" });
    await frame();
    expect(root.classList.contains("awi-indicator")).toBe(true);
    expect(body.style.width).toBe("48px");
    expect(body.getAttribute("aria-label")).toBe("Run: on");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(root.classList.contains("awi-stale")).toBe(false);
  });

  test("a toggle switch writes its value and a sequence number back", async () => {
    const { model, body } = mount({ ...defaults("ToggleSwitch"), label: "Pump" });
    await frame();
    press(body);
    expect(model.get("value")).toBe(true);
    expect(model.saved.at(-1)).toMatchObject({ value: true, _pressed: false, _seq: 2 });
    press(body);
    expect(model.get("value")).toBe(false);
  });

  test("the emergency stop latches and never writes false", async () => {
    const { model, body } = mount({ ...defaults("EmergencyStop"), label: "E-stop" });
    await frame();
    press(body);
    expect(model.get("value")).toBe(true);
    press(body);
    expect(model.get("value")).toBe(true);
    expect(model.saved.some((s) => s.value === false)).toBe(false);
    model.push("value", false); // reset by the host
    await frame();
    expect(body.getAttribute("aria-pressed")).toBe("false");
  });

  test("invalid traits fall back to the schema", async () => {
    const { model, body } = mount({ ...defaults("PushButton"), mechanical_action: "explode", color: "pink", text: 42 });
    await frame();
    expect(body.querySelector(".awi-cap-grey")).not.toBeNull();
    press(body); // latch_when_released (the PushButton default)
    expect(model.get("value")).toBe(true);
  });
});

describe("Operator objects without a kernel", () => {
  test("a selector resolves its position as the kernel does", async () => {
    const { model, el } = mount({ ...defaults("SelectorSwitch"), positions: ["1", "2", "3", "4"], label: "Speed" });
    await frame();
    expect((el.querySelector(".awi-choice") as HTMLSelectElement).value).toBe("3");
    model.push("positions", ["X"]); // invalid (fewer than 2): the schema default is used
    await frame();
    expect((el.querySelector(".awi-choice") as HTMLSelectElement).value).toBe("OFF");
  });

  test("a locked key switch ignores the operator", async () => {
    const { model, el } = mount({ ...defaults("SelectorSwitch"), value: "AUTO", keyed: true, locked: true });
    await frame();
    const choice = el.querySelector(".awi-choice") as HTMLSelectElement;
    choice.value = "HAND";
    choice.dispatchEvent(new Event("change"));
    expect(model.get("value")).toBe("AUTO");
    expect(model.saved).toHaveLength(0);
  });

  test("a stack light shows one state per tier", async () => {
    const { body } = mount({ ...defaults("StackLight"), tiers: ["red", "amber", "green", "blue"], value: ["on", "purple"], label: "Line" });
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Line: red on, amber off, green off, blue off");
  });
});

describe("Alarms and indicators without a kernel", () => {
  test("ACK acknowledges the alarm and still tells the host", async () => {
    const sent: unknown[] = [];
    const { model, el } = mount({ ...defaults("AlarmIndicator"), value: "active_unacknowledged", alarm_id: "TAH-101", message: "High temperature" });
    model.send = (msg: unknown) => {
      sent.push(msg);
    };
    await frame();
    (el.querySelector(".awi-ack") as HTMLButtonElement).click();
    expect(sent).toEqual([{ type: "ack" }]);
    expect(model.get("value")).toBe("active_acknowledged");
    expect(model.saved.at(-1)).toMatchObject({ value: "active_acknowledged" });
    model.push("value", "cleared_unacknowledged");
    await frame();
    (el.querySelector(".awi-ack") as HTMLButtonElement).click();
    expect(model.get("value")).toBe("normal");
  });

  test("with a kernel, ACK is only sent: the kernel applies it", async () => {
    const sent: unknown[] = [];
    const { model, el } = mount({ ...defaults("AlarmIndicator"), _session: "kernel", value: "active_unacknowledged" });
    model.send = (msg: unknown) => {
      sent.push(msg);
    };
    await frame();
    (el.querySelector(".awi-ack") as HTMLButtonElement).click();
    expect(sent).toEqual([{ type: "ack" }]);
    expect(model.get("value")).toBe("active_unacknowledged");
  });

  test("a deviation bar reads an invalid span as its default", async () => {
    const { root } = mount({ ...defaults("DeviationIndicator"), value: 53, setpoint: 50, tolerance: 1, span: 0 });
    await frame();
    expect(root.querySelector(".awi-badge")?.textContent).toBe("▲ HIGH");
  });

  test("a pipe and a theme switch render from their defaults", async () => {
    const pipe = mount({ ...defaults("Pipe"), value: true, rotation: 45 });
    await frame();
    expect(pipe.root.classList.contains("awi-indicator")).toBe(true);
    const sw = mount({ ...defaults("ThemeSwitch") });
    await frame();
    (sw.el.querySelector('button[data-value="dark"]') as HTMLButtonElement).click();
    expect(sw.model.get("value")).toBe("dark");
  });
});

describe("Compact indicators without a kernel", () => {
  test("a bar graph computes its alarm levels and writes them back", async () => {
    const { model, body } = mount({ ...defaults("BarGraph"), bars: ["Z1", { label: "Z2", hi: 80 }], value: [50, 85], label: "Zones" });
    await frame();
    expect(model.get("alarm_levels")).toEqual(["normal", "hi"]);
    expect(model.saved.at(-1)).toMatchObject({ alarm_levels: ["normal", "hi"] });
    expect(body.getAttribute("aria-label")).toBe("Zones: Z1 50.0, Z2 85.0 HI");
  });

  test("a sparkline decodes history buffers given as ArrayBuffer (HOST-008)", async () => {
    const sent: unknown[] = [];
    const model = hostModel({ ...defaults("Sparkline"), label: "Level" });
    model.send = (msg: unknown) => {
      sent.push(msg);
    };
    const el = document.createElement("div");
    document.body.appendChild(el);
    widget.initialize({ model });
    widget.render({ model, el });
    expect(sent).toEqual([{ type: "sync_request" }]);
    const fire = (msg: unknown, values: number[]) => model.fireMsg(msg, [new Float32Array(values).buffer]);
    fire({ type: "snapshot", n: 3 }, [1, 3, 2]);
    fire({ type: "append", n: 1 }, [2.5]);
    await frame();
    expect(el.querySelector(".awi-body")?.getAttribute("aria-label")).toBe("Level: last 2.5, min 1, max 3");
  });

  test("a KPI tile shows its difference to the target", async () => {
    const { el } = mount({ ...defaults("KPITile"), value: 84.6, target: 85, unit: "%", label: "OEE" });
    await frame();
    expect(el.querySelector(".awi-kpi-delta")?.textContent).toBe("▼ -0.4 % vs target 85.0 % ✗");
  });
});

describe("Process objects without a kernel", () => {
  const faceplate = async (m: ReturnType<typeof mount>) => {
    m.body.click();
    await frame();
    return (text: string) => [...m.el.querySelectorAll(".awi-faceplate button")].find((b) => b.textContent === text) as HTMLButtonElement;
  };

  test("a simulated pump follows its faceplate", async () => {
    const m = mount({ ...defaults("Pump"), tag: "P-101", simulate: true, mode: "control" });
    const sent: unknown[] = [];
    m.model.send = (msg: unknown) => {
      sent.push(msg);
    };
    await frame();
    const button = await faceplate(m);
    expect(button("Start").disabled).toBe(true); // auto: commands disabled
    button("Manual").click();
    expect(m.model.get("auto")).toBe(false);
    await frame();
    button("Start").click();
    expect(m.model.get("value")).toBe("running");
    expect(sent).toEqual([{ type: "command", command: "manual" }, { type: "command", command: "start" }]);
    expect(m.model.saved.at(-1)).toMatchObject({ auto: false, value: "running" });
  });

  test("with a kernel, the faceplate only sends commands", async () => {
    const m = mount({ ...defaults("Pump"), _session: "kernel", simulate: true, mode: "control" });
    await frame();
    const button = await faceplate(m);
    button("Manual").click();
    expect(m.model.get("auto")).toBe(true);
    expect(m.model.saved).toHaveLength(0);
  });

  test("a simulated control valve takes a position demand", async () => {
    const m = mount({ ...defaults("Valve"), simulate: true, auto: false, position: 30, mode: "control" });
    await frame();
    await faceplate(m);
    const field = m.el.querySelector(".awi-fp-position .awi-entry") as HTMLInputElement;
    field.value = "42";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(m.model.get("position")).toBe(42);
    expect(m.model.get("value")).toBe("open");
  });
});

describe("Event log without a kernel", () => {
  test("shows at most the newest max_events", async () => {
    const events = [1, 2, 3].map((id) => ({ id, time: 1767254400 + id, source: "P-101", category: "state", message: `event ${id}` }));
    const { body } = mount({ ...defaults("EventLog"), value: events, max_events: 2, label: "Journal" });
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Journal: 2 events, latest event 3");
    expect(body.querySelectorAll("tbody tr")).toHaveLength(2);
  });
});

describe("State machine without a kernel", () => {
  const cmd = (el: HTMLElement, name: string) => [...el.querySelectorAll(".awi-sm-cmd")].find((b) => b.textContent === name) as HTMLButtonElement;

  test("the PackML model, the resolved state and its commands", async () => {
    const sent: unknown[] = [];
    const { model, el } = mount({ ...defaults("StateMachine"), label: "Line" });
    model.send = (msg: unknown) => {
      sent.push(msg);
    };
    await frame();
    expect(model.get("value")).toBe("Stopped");
    expect(model.get("available_commands")).toEqual(["Reset", "Abort"]);
    cmd(el, "Reset").click();
    expect(sent).toEqual([{ type: "command", command: "Reset" }]);
    expect(model.get("value")).toBe("Resetting");
    expect(model.get("last_command")).toBe("Reset");
    expect(model.get("available_commands")).toEqual(["Stop", "Abort"]);
    expect(model.saved.at(-1)).toMatchObject({ value: "Resetting", available_commands: ["Stop", "Abort"] });
    model.push("value", "Idle"); // state completion (SC) is a host event
    await frame();
    expect(model.get("available_commands")).toEqual(["Start", "Stop", "Abort"]);
  });

  test("an invalid model reads as the default; a custom one works", async () => {
    const { model } = mount({ ...defaults("StateMachine"), machine: { states: [] } });
    await frame();
    expect(model.get("value")).toBe("Stopped");
    model.push("machine", { states: [{ name: "Off" }, { name: "On" }], transitions: [["Off", "Start", "On"], ["On", "Stop", "Off"]] });
    expect(model.get("value")).toBe("Off");
    expect(model.get("available_commands")).toEqual(["Start"]);
  });

  test("with a kernel, commands are only sent", async () => {
    const { model, el } = mount({ ...defaults("StateMachine"), _session: "kernel", value: "Stopped", available_commands: ["Reset", "Abort"] });
    await frame();
    cmd(el, "Reset").click();
    expect(model.get("value")).toBe("Stopped");
    expect(model.saved).toHaveLength(0);
  });
});

describe("PID faceplate without a kernel", () => {
  const enter = (el: HTMLElement, field: number, value: string) => {
    const input = el.querySelectorAll(".awi-pid-input")[field] as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  };
  const modeButton = (el: HTMLElement, m: string) => [...el.querySelectorAll(".awi-pid-mode")].find((b) => b.textContent === m) as HTMLButtonElement;

  test("alarm on PV, summary, SP entry and SP tracking", async () => {
    const sent: unknown[] = [];
    const { model, el } = mount({ ...defaults("PIDFaceplate"), tag: "TIC-101", pv: 95, hi: 90, sp: 300, sp_max: 150, sp_tracking: true, confirm_delta: 20 });
    model.send = (msg: unknown) => {
      sent.push(msg);
    };
    await frame();
    expect(model.get("alarm_level")).toBe("hi");
    expect(model.get("value")).toEqual({ pv: 95, sp: 150, op: 0, mode: "AUTO" }); // sp shown clamped
    enter(el, 0, "140");
    expect(sent.at(-1)).toEqual({ type: "set", field: "sp", value: 140, confirmed: false });
    expect(model.get("sp")).toBe(140);
    enter(el, 0, "10"); // larger than confirm_delta: needs a confirmation
    expect(model.get("sp")).toBe(140);
    (el.querySelector(".awi-pid-confirm") as HTMLButtonElement).click();
    expect(model.get("sp")).toBe(10);
    modeButton(el, "MAN").click();
    expect(model.get("loop_mode")).toBe("MAN");
    modeButton(el, "AUTO").click(); // leaving MAN with sp_tracking: SP = PV
    expect(model.get("sp")).toBe(95);
  });

  test("with a kernel, entries are only sent", async () => {
    const { model, el } = mount({ ...defaults("PIDFaceplate"), _session: "kernel", pv: 50 });
    await frame();
    enter(el, 0, "40");
    expect(model.get("sp")).toBe(0);
    expect(model.saved).toHaveLength(0);
  });
});

describe("Tank without a kernel", () => {
  test("indicator by default, markers read through the schema", async () => {
    const { root, body, el } = mount({ ...defaults("Tank"), value: 3.2, max: 4, unit: "m", markers: [0.5, "x", 3.5], hi: 3, hihi: 3.5 });
    await frame();
    expect(root.classList.contains("awi-indicator")).toBe(true);
    expect(body.getAttribute("role")).toBe("meter");
    expect(body.style.width).toBe("120px");
    expect(el.querySelectorAll(".awi-marker")).toHaveLength(2);
    expect(root.classList.contains("awi-alarm-hi")).toBe(true);
  });
});

describe("with a host owning the state (Python kernel)", () => {
  test("the host alarm level is shown and not overwritten", async () => {
    const { model, root } = mount({ ...defaults("Knob"), _session: "kernel", value: 95, hi: 80, alarm_level: "normal" });
    await frame();
    expect(root.classList.contains("awi-alarm-hi")).toBe(false);
    expect(model.saved).toHaveLength(0);
    model.push("alarm_level", "hi");
    await frame();
    expect(root.classList.contains("awi-alarm-hi")).toBe(true);
  });

  test("announced heartbeats that never come still show NO KERNEL (ROB-004 unchanged)", async () => {
    const { root } = mount({ ...defaults("Knob"), _session: "saved-notebook", _heartbeat: 2, value: 10 });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(root.classList.contains("awi-stale")).toBe(true);
    expect(root.querySelector(".awi-stale-badge")?.textContent).toContain("NO KERNEL");
  });
});
