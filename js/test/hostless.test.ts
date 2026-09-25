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

/** Text of the CSV export of a graph (CHART-107). */
async function csvOf(el: HTMLElement): Promise<string> {
  const blobs: Blob[] = [];
  Object.assign(URL, { createObjectURL: (b: Blob) => (blobs.push(b), "blob:x"), revokeObjectURL: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  (el.querySelector('button[aria-label="Download data as CSV"]') as HTMLButtonElement).click();
  vi.useRealTimers(); // FileReader completes on real timers
  try {
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blobs[0]);
    });
  } finally {
    vi.useFakeTimers();
  }
}

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

describe("Annunciator without a kernel", () => {
  const states = (m: { get(k: string): unknown }) => Object.fromEntries((m.get("value") as Array<{ tag: string; state: string; first: boolean }>).map((w) => [w.tag, [w.state, w.first]]));
  const press = (el: HTMLElement, key: string) => (el.querySelector(`.awi-ann-${key}`) as HTMLButtonElement).click();

  test("process conditions from the host, operator buttons on the front end", async () => {
    const windows = [{ tag: "PAH-101", text: "Pressure high" }, { tag: "TAL-102", text: "Temperature low", color: "red" }];
    const { model, el } = mount({ ...defaults("Annunciator"), value: windows, sequence: "R", first_out: true });
    await frame();
    expect(states(model)).toEqual({ "PAH-101": ["normal", false], "TAL-102": ["normal", false] });
    model.push("value", [{ ...windows[0], active: true }, windows[1]]); // the host raises a condition
    expect(states(model)).toEqual({ "PAH-101": ["alert", true], "TAL-102": ["normal", false] });
    expect(model.get("horn")).toBe(true);
    press(el, "silence");
    expect(model.get("horn")).toBe(false);
    press(el, "acknowledge");
    expect(states(model)["PAH-101"]).toEqual(["acknowledged", true]);
    const acked = model.get("value") as Array<Record<string, unknown>>;
    model.push("value", [{ ...acked[0], active: false }, acked[1]]); // the condition clears: ringback
    expect(states(model)["PAH-101"]).toEqual(["ringback", true]);
    expect(model.get("horn")).toBe(true);
    press(el, "reset");
    expect(states(model)["PAH-101"]).toEqual(["normal", false]);
    expect(model.saved.at(-1)).toMatchObject({ horn: false });
  });

  test("windows given active by the host start in alert", async () => {
    const { model } = mount({ ...defaults("Annunciator"), value: [{ tag: "XA-1", active: true }] });
    await frame();
    expect(states(model)).toEqual({ "XA-1": ["alert", false] });
    model.push("sequence", "M");
    expect(states(model)).toEqual({ "XA-1": ["alert", false] });
  });
});

describe("Alarm banner and alarm list without a kernel", () => {
  const rows = [
    { id: "TAH-101", timestamp: "2026-09-24T10:00:00", source: "R-1", priority: "critical", message: "High", state: "active_unacknowledged" },
    { id: "LAL-7", timestamp: "2026-09-24T10:01:00", source: "T-7", priority: "low", message: "Low", state: "cleared_unacknowledged" },
  ];

  test("the banner applies acknowledgements", async () => {
    const { model, el } = mount({ ...defaults("AlarmBanner"), value: rows });
    await frame();
    (el.querySelector('button[aria-label="Acknowledge LAL-7"]') as HTMLButtonElement).click();
    expect((model.get("value") as unknown[]).length).toBe(1); // cleared + acknowledged: back to normal, removed
    (el.querySelector(".awi-banner-head .awi-ack") as HTMLButtonElement).click(); // ACK ALL
    expect(model.get("value")).toMatchObject([{ id: "TAH-101", state: "active_acknowledged" }]);
  });

  test("the list shelves an alarm and lifts the shelving when it expires", async () => {
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0, 0));
    const { model, el } = mount({ ...defaults("AlarmList"), value: rows.map((r) => ({ ...r, shelved_until: null, suppressed: false, out_of_service: false })) });
    await frame();
    const shelve = el.querySelector('select[aria-label="Shelve TAH-101"]') as HTMLSelectElement;
    shelve.value = "300";
    shelve.dispatchEvent(new Event("change"));
    expect((model.get("value") as Array<{ id: string; shelved_until: string | null }>).find((r) => r.id === "TAH-101")?.shelved_until).toBe("2026-09-24T10:05:00");
    await vi.advanceTimersByTimeAsync(301_000);
    expect((model.get("value") as Array<{ id: string; shelved_until: string | null }>).find((r) => r.id === "TAH-101")?.shelved_until).toBe(null);
  });
});

describe("Polar family without a kernel", () => {
  test("polar plot: non-finite magnitudes skipped, radial range set by the operator", async () => {
    const { model, el, body } = mount({ ...defaults("PolarPlot"), label: "Pattern", value: [{ name: "E", style: "markers", r: [1, "nan", 2], theta: [0, 90, "x"] }, "not a set"], rings: 0 });
    await frame();
    // one data set kept, points with a non-finite coordinate skipped
    expect(el.querySelectorAll(".awi-series-marker")).toHaveLength(1);
    expect(body.getAttribute("aria-label")).toBe("Pattern: 1 data set (E)");
    const field = el.querySelector('input[aria-label="Radial range maximum"]') as HTMLInputElement;
    field.value = "5";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.get("r_max")).toBe(5);
    expect(model.saved.at(-1)).toMatchObject({ r_max: 5 });
  });

  test("smith chart: an invalid z0 falls back to 50 ohms in the tooltips", async () => {
    const { el } = mount({ ...defaults("SmithChart"), z0: 0, value: [{ name: "load", re: [0.2], im: [0.4] }] });
    await frame();
    expect(el.querySelector(".awi-series-marker title")?.textContent).toBe("load: Z = 50 + j50 Ω  |Γ| = 0.447");
  });

  test("radar chart: an axis without a valid range goes from 0 to the largest value", async () => {
    const { el } = mount({ ...defaults("RadarChart"), axes: ["a", "b", "c"], ranges: [[0, 10], [5, 5], [0, 2]], value: [{ name: "x", values: [5, 4, "nan"] }, { name: "y", values: [1, 8, 1] }] });
    await frame();
    expect([...el.querySelectorAll(".awi-radar-max")].map((t) => t.textContent)).toEqual(["10", "8", "2"]);
    expect(el.querySelectorAll(".awi-legend-item")).toHaveLength(2);
  });
});

describe("Picture control without a kernel", () => {
  test("draw messages with ArrayBuffer images; a click is recorded in value", async () => {
    const { model, el } = mount({ ...defaults("PictureControl"), label: "Scene" });
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]).buffer; // 2×1 rgba
    model.fireMsg({ type: "draw", clear: true, commands: [{ op: "rect", x: 1, y: 2, w: 3, h: 4, fill: "red" }, { op: "image", x: 0, y: 0, mime: "rgba", pw: 2, ph: 1, buffer: 0 }, null] }, [pixels]);
    await frame();
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    expect(el.querySelector(".awi-body")?.getAttribute("aria-label")).toBe("Scene");
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 200 }) as DOMRect;
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 30, clientY: 40, button: 0 }));
    expect(model.get("value")).toEqual({ x: 30, y: 40, button: 0 });
    expect(model.saved.at(-1)).toMatchObject({ value: { x: 30, y: 40, button: 0 } });
  });

  test("with a host owning the state, the click is only sent", async () => {
    const { model, el } = mount({ ...defaults("PictureControl"), _session: "kernel" });
    const sent: unknown[] = [];
    model.send = (c: unknown) => void sent.push(c);
    const canvas = el.querySelector("canvas") as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 320, height: 200 }) as DOMRect;
    canvas.dispatchEvent(new MouseEvent("pointerdown", { clientX: 5, clientY: 6, button: 2 }));
    expect(sent).toEqual([{ type: "click", x: 5, y: 6, button: 2 }]);
    expect(model.get("value")).toEqual({});
  });
});

describe("Waveform chart without a kernel", () => {
  const f32 = (...v: number[]) => new Float32Array(v).buffer;

  test("samples from ArrayBuffer messages; a short buffer is not over-read", async () => {
    const { model, body } = mount({ ...defaults("WaveformChart"), label: "Scope", n_traces: 2, history: 4, unit: "V" });
    model.fireMsg({ type: "snapshot", n_points: 2, total: 2 }, [f32(1, 10, 2, 20)]);
    model.fireMsg({ type: "append", n_points: 3, total: 5 }, [f32(3, 30, 4, 40)]); // one row missing
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Scope: latest 4, 40 V");
    model.fireMsg({ type: "clear" }, []);
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Scope: latest NaN, NaN V");
  });

  test("cursors and the Y range set by the operator are written back", async () => {
    const { model, el } = mount({ ...defaults("WaveformChart"), history: 10, dt: 0.5, cursors: [{ x: 1 }] });
    model.fireMsg({ type: "snapshot", n_points: 10, total: 10 }, [f32(...Array.from({ length: 10 }, (_, i) => i))]);
    await frame();
    const field = el.querySelector('input[aria-label="Position of cursor 1"]') as HTMLInputElement;
    expect(field.value).toBe("1");
    field.value = "2.5";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.get("cursors")).toEqual([{ x: 2.5 }]);
    const axes = el.querySelector('button[aria-label="Set the axis ranges"]') as HTMLButtonElement;
    axes.click();
    (el.querySelector('input[aria-label="Y minimum"]') as HTMLInputElement).value = "-5";
    (el.querySelector('input[aria-label="Y maximum"]') as HTMLInputElement).value = "5";
    (el.querySelector('input[aria-label="X maximum"]') as HTMLInputElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(model.saved.at(-1)).toMatchObject({ autoscale_y: false, y_min: -5, y_max: 5 });
  });
});

describe("Intensity chart without a kernel", () => {
  test("rows from ArrayBuffer messages, fixed color range", async () => {
    const { model, body, el } = mount({ ...defaults("IntensityChart"), label: "Spectrum", history: 3, n_bins: 2, autoscale_z: false, z_max: 10, unit: "dB" });
    model.fireMsg({ type: "append", n_rows: 2, total: 2 }, [new Float32Array([1, 2, 3, 4]).buffer]);
    model.fireMsg({ type: "append", n_rows: 3, total: 5 }, [new Float32Array([5, 6]).buffer]); // short buffer
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Spectrum: 5 rows, color range 0 to 10 dB");
    // rows 2 to 4 kept; 3 and 4 were missing from the buffer: empty, not stale data
    expect(await csvOf(el)).toBe("x,0.5,1.5\n2,5,6\n3,,\n4,,");
    model.fireMsg({ type: "clear" }, []);
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Spectrum: 0 rows, color range 0 to 10 dB");
  });
});

describe("Digital and mixed-signal graphs without a kernel", () => {
  test("data message with ArrayBuffers; a bus naming a missing line keeps the others", async () => {
    const { model, el, body } = mount({ ...defaults("DigitalWaveformGraph"), label: "Bus", lines: ["CLK"], buses: [{ name: "B", lines: [1, 0, 9] }], show_lines_in_bus: false, dt: 2 });
    const bits = new Uint8Array([1, 0, 0, 1, 1, 1]).buffer; // 3 samples × 2 lines
    model.fireMsg({ type: "data", n_samples: 4, n_lines: 2, n_analog: 0, n_traces: 0 }, [bits, new ArrayBuffer(0)]); // one sample too many
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Bus: 2 lines, 3 samples");
    expect(await csvOf(el)).toBe("x,B\n0,0x1\n2,0x2\n4,0x3");
  });

  test("mixed signal: analog traces after the logic lines", async () => {
    const { model, el } = mount({ ...defaults("MixedSignalGraph"), traces: [{ name: "V" }] });
    model.fireMsg({ type: "data", n_samples: 2, n_lines: 1, n_analog: 2, n_traces: 1 }, [new Uint8Array([0, 1]).buffer, new Float32Array([0.5, 1.5]).buffer]);
    await frame();
    expect(await csvOf(el)).toBe("x,D0,V\n0,0,0.5\n1,1,1.5");
  });
});

describe("Trend chart without a kernel", () => {
  test("pens with defaults, samples from ArrayBuffers, a short buffer is not over-read", async () => {
    const { model, el, body } = mount({ ...defaults("TrendChart"), label: "Level", pens: [{ name: "LT-101" }, "not a pen", { name: "FT", unit: "L/s", min: 5, max: 5 }], value: { "LT-101": 2.5, FT: "nan" } });
    const t0 = Date.UTC(2026, 8, 24, 10, 0, 0) / 1000;
    const times = new Float64Array([t0, t0 + 1, t0 + 2]).buffer;
    model.fireMsg({ type: "snapshot", pens: [[0, 3, 3], [1, 3, 3]] }, [times, new Float32Array([1, 2, 3]).buffer, times, new Float32Array([7]).buffer]);
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Level: LT-101 2.5, FT NaN L/s");
    // FT has an invalid scale (max <= min): shown as 0 .. 100
    expect(el.querySelectorAll(".awi-pen")[1].textContent).toContain("[0 … 100]");
    const csv = await csvOf(el);
    expect(csv.split("\n").filter((l) => l.includes(",FT,"))).toHaveLength(1);
    expect(csv.split("\n").filter((l) => l.includes(",LT-101,"))).toHaveLength(3);
  });

  test("the span chosen by the operator is written back", async () => {
    const { model, el } = mount({ ...defaults("TrendChart"), pens: ["A"] });
    await frame();
    const sel = el.querySelector('select[aria-label="Time span"]') as HTMLSelectElement;
    sel.value = "3600";
    sel.dispatchEvent(new Event("change"));
    expect(model.get("span")).toBe(3600);
    expect(model.saved.at(-1)).toMatchObject({ span: 3600 });
  });
});

describe("Synoptic canvas without a kernel", () => {
  test("base64 background typed from its bytes, pipes drawn, children as placeholders", async () => {
    const blobs: Blob[] = [];
    Object.assign(URL, { createObjectURL: (b: Blob) => (blobs.push(b), `blob:${blobs.length}`), revokeObjectURL: () => {} });
    const png = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0));
    const { el } = mount({
      ...defaults("SynopticCanvas"),
      background: png, // no background_mime: detected as Python does
      items: [{ widget: "IPY_MODEL_abc", x: 10, y: 20 }],
      pipes: [{ points: [[0, 0], [100, 0]], flow: true }, { points: [[5, 5]] }],
    });
    await frame();
    const img = el.querySelector(".awi-synoptic-bg") as HTMLImageElement;
    expect(img.hidden).toBe(false);
    expect(blobs[0].type).toBe("image/png");
    expect(blobs[0].size).toBe(10);
    expect(el.querySelector(".awi-synoptic-item")?.textContent).toContain("need a Jupyter host");
    expect((el.querySelector(".awi-synoptic-item") as HTMLElement).style.left).toBe("10px");
    expect(el.querySelectorAll(".awi-synoptic-pipes path").length).toBeGreaterThan(0);
  });

  test("bytes that are not an image show no background", async () => {
    const { el } = mount({ ...defaults("SynopticCanvas"), background: btoa("hello"), background_mime: "" });
    await frame();
    expect((el.querySelector(".awi-synoptic-bg") as HTMLImageElement).hidden).toBe(true);
  });
});

describe("Hexadecimal and binary display (IND-110)", () => {
  test("a keypad in hexadecimal shows A..F, hides the decimal point and commits the word", async () => {
    const { model, el } = mount({ ...defaults("NumericEntry"), label: "Register", format: "%04X", min: 0, max: 65535, value: 31 });
    await frame();
    expect(el.querySelector(".awi-kp-display")?.textContent).toBe("001F");
    const key = (name: string) => el.querySelector(`button[aria-label="${name}"]`) as HTMLButtonElement;
    expect(key("F").hidden).toBe(false);
    expect(key("Decimal point").disabled).toBe(true);
    expect(key("Clear the entry").textContent).toBe("Clr"); // not to be confused with the C digit
    key("1").click();
    key("A").click();
    key("F").click();
    key("Enter").click();
    expect(model.get("value")).toBe(0x1af);
  });

  test("hex keys stay hidden in decimal; a tank shows its value in binary", async () => {
    const { el } = mount({ ...defaults("NumericEntry"), format: "%.1f" });
    await frame();
    expect((el.querySelector('button[aria-label="F"]') as HTMLButtonElement).hidden).toBe(true);
    const tank = mount({ ...defaults("Tank"), value: 5, max: 7, format: "%03b" });
    await frame();
    expect(tank.body.getAttribute("aria-valuetext")).toBe("101");
  });
});

describe("Bit field without a kernel", () => {
  test("a status word as lamps, MSB first, with its hexadecimal value", async () => {
    const { body, el } = mount({ ...defaults("BitField"), label: "Status", bits: 8, value: 0x13, labels: ["Ready", "Running", "", "", "Fault"], colors: ["", "", "", "", "red"] });
    await frame();
    const cells = [...el.querySelectorAll(".awi-bf-bit")] as HTMLButtonElement[];
    expect(cells.map((c) => c.dataset.bit)).toEqual(["7", "6", "5", "4", "3", "2", "1", "0"]);
    expect(cells.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "true", "false", "false", "true", "true"]);
    expect(cells[3].textContent).toBe("14Fault");
    expect(cells[3].style.getPropertyValue("--awi-bf-on")).toBe("red");
    expect(cells[0].classList.contains("awi-bf-unused")).toBe(true);
    expect(el.querySelector(".awi-bf-hex")?.textContent).toBe("0x13");
    expect(body.getAttribute("aria-label")).toBe("Status: 0x13, set: 0 Ready, 1 Running, 4 Fault");
    // indicator by default: bits cannot be toggled
    expect(cells[0].disabled).toBe(true);
  });

  test("control mode: a click toggles a bit and writes the word back (IND-112)", async () => {
    const { model, el } = mount({ ...defaults("BitField"), mode: "control", bits: 32, value: 0x80000000 });
    await frame();
    const bit = (n: number) => el.querySelector(`.awi-bf-bit[data-bit="${n}"]`) as HTMLButtonElement;
    bit(31).click();
    expect(model.get("value")).toBe(0);
    bit(0).click();
    expect(model.saved.at(-1)).toMatchObject({ value: 1 });
    await frame();
    expect(el.querySelector(".awi-bf-hex")?.textContent).toBe("0x00000001");
  });
});

describe("Recipe table without a kernel", () => {
  const columns = [
    { name: "step", type: "text" },
    { name: "temp", title: "Temperature", unit: "°C", min: 20, max: 90, step: 0.5, format: "%.1f" },
    { name: "agitator", type: "choice", choices: ["off", "slow", "fast"] },
    { name: "hold", type: "bool" },
  ];
  const value = [
    { step: "Heat", temp: 65, agitator: "slow", hold: false },
    { step: "Cool", temp: 30, agitator: "off", hold: true },
  ];

  test("indicator: rows as text, sorted by a column on demand (IND-114)", async () => {
    const { el, body } = mount({ ...defaults("RecipeTable"), mode: "indicator", label: "Recipe", columns, value });
    await frame();
    const rows = () => [...el.querySelectorAll("tbody tr")].map((tr) => tr.textContent);
    expect(rows()).toEqual(["1Heat65.0slow☐ no", "2Cool30.0off☑ yes"]);
    expect(body.getAttribute("aria-label")).toBe("Recipe: 2 rows, 4 columns (step, Temperature °C, agitator, hold)");
    (el.querySelectorAll(".awi-rt-sort")[1] as HTMLButtonElement).click(); // Temperature
    await frame();
    expect(rows()[0]).toContain("Cool");
    expect(el.querySelectorAll("thead th")[2].getAttribute("aria-sort")).toBe("ascending");
  });

  test("control: cells checked, snapped and written back; rows added and deleted", async () => {
    const { model, el } = mount({ ...defaults("RecipeTable"), columns, value, row_edit: true });
    await frame();
    const field = el.querySelector('input[aria-label="Row 1, Temperature"]') as HTMLInputElement;
    field.value = "95";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(el.querySelector(".awi-rt-msg")?.textContent).toBe("Row 1, Temperature: Out of range: enter a value between 20 and 90 °C");
    expect(field.getAttribute("aria-invalid")).toBe("");
    field.value = "72,3";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect((model.get("value") as Array<Record<string, unknown>>)[0].temp).toBe(72.5);
    const sel = el.querySelector('select[aria-label="Row 2, agitator"]') as HTMLSelectElement;
    sel.value = "fast";
    sel.dispatchEvent(new Event("change"));
    expect((model.get("value") as Array<Record<string, unknown>>)[1].agitator).toBe("fast");
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await frame();
    (el.querySelector(".awi-rt-add") as HTMLButtonElement).click();
    expect(model.get("value")).toHaveLength(3);
    expect((model.get("value") as Array<Record<string, unknown>>)[2]).toEqual({ step: "", temp: 20, agitator: "off", hold: false });
    await frame();
    (el.querySelector('button[aria-label="Delete row 1"]') as HTMLButtonElement).click();
    expect((model.get("value") as Array<Record<string, unknown>>).map((r) => r.step)).toEqual(["Cool", ""]);
  });

  test("with a host owning the state, edits are sent and a rejection is shown", async () => {
    const { model, el } = mount({ ...defaults("RecipeTable"), _session: "kernel", columns, value });
    const sent: unknown[] = [];
    model.send = (c: unknown) => void sent.push(c);
    await frame();
    const field = el.querySelector('input[aria-label="Row 2, Temperature"]') as HTMLInputElement;
    field.value = "40";
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(sent).toEqual([{ type: "edit", row: 1, column: "temp", value: 40 }]);
    expect((model.get("value") as Array<Record<string, unknown>>)[1].temp).toBe(30);
    model.fireMsg({ type: "rejected", row: 1, column: "temp", reason: "interlocked" }, []);
    expect(el.querySelector(".awi-rt-msg")?.textContent).toBe("Row 2, Temperature: interlocked");
  });
});

describe("XY graph without a kernel", () => {
  test("data sets from ArrayBuffer messages, listed sets only, CSV export", async () => {
    const f64 = (...v: number[]) => new Float64Array(v).buffer;
    const { model, el, body } = mount({ ...defaults("XYGraph"), label: "Pump curve", series: [{ name: "Head", style: "line" }, { name: "Measured", style: "markers" }], x_unit: "m³/h", unit: "m" });
    model.fireMsg({ type: "data", clear: true, sets: [["Head", 3], ["Measured", 2], ["Other", 1]] }, [f64(0, 60, 120), f64(42, 34.8, 13.2), f64(30), f64(40.5, 99), f64(1), f64(2)]);
    await frame();
    // "Measured" announced 2 points but its x buffer holds 1; "Other" is not listed
    expect(body.getAttribute("aria-label")).toBe("Pump curve: 2 data sets, 4 points (Head, Measured)");
    expect(await csvOf(el)).toBe("set,x (m³/h),y (m)\nHead,0,42\nHead,60,34.8\nHead,120,13.2\nMeasured,30,40.5");
    model.fireMsg({ type: "data", clear: false, sets: [["Measured", 1]] }, [f64(90), f64(26.3)]);
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Pump curve: 2 data sets, 4 points (Head, Measured)");
    model.fireMsg({ type: "data", clear: true, sets: [] }, []);
    await frame();
    expect(body.getAttribute("aria-label")).toBe("Pump curve: 0 data sets, 0 points");
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
