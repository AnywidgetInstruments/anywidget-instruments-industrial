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
    send: () => {},
    /** A value pushed by the host (e.g. a Julia cell re-run). */
    push(k: string, v: unknown) {
      traits[k] = v;
      fire(`change:${k}`);
    },
  };
}

/** Class defaults as a host reads them (schema defaults), plus the user's traits. */
function defaults(title: "Knob" | "Tank"): State {
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
