// Compact indicators and keypad (IND-100..104).
import { describe, expect, it } from "vitest";
import widget from "../src/index.js";
import { ValueRing, kpiDelta } from "../src/widgets/compact.js";
import { editDraft } from "../src/widgets/keypad.js";
import { common, fakeModel } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 30));
const render = async (state) => {
  const model = fakeModel({ ...common, mode: "indicator", ...state });
  const el = document.createElement("div");
  widget.render({ model, el });
  await tick();
  return { model, el, body: el.querySelector(".awi-body") };
};

describe("DeviationIndicator (IND-100)", () => {
  it("shows the deviation, grey inside the tolerance and HIGH / LOW outside", async () => {
    const { model, el, body } = await render({ label: "Temp deviation", _kind: "deviation", value: 50.5, setpoint: 50, tolerance: 1.5, span: 5, unit: "°C", format: "%+.1f", size: [220, 44] });
    expect(el.querySelector(".awi-value").textContent).toBe("Δ +0.5 °C");
    expect(el.querySelector(".awi-badge").hidden).toBe(true);
    expect(el.querySelector(".awi-root").classList.contains("awi-dev-out")).toBe(false);
    expect(body.getAttribute("aria-valuetext")).toBe("deviation +0.5 °C, tolerance ±1.5, within tolerance");
    model.set("value", 47);
    model.emit("change:value");
    await tick();
    expect(el.querySelector(".awi-badge").textContent).toBe("▼ LOW");
    expect(el.querySelector(".awi-root").classList.contains("awi-dev-out")).toBe(true);
    expect(body.getAttribute("aria-valuenow")).toBe("-3");
  });
});

describe("Sparkline (IND-101)", () => {
  it("keeps the last values and marks min and max", async () => {
    const ring = new ValueRing(3);
    ring.push(new Float32Array([1, 2, 3, 4]), 4);
    expect(ring.values()).toEqual([2, 3, 4]);
    const { model, el, body } = await render({ label: "Level", _kind: "sparkline", value: 3, history: 10, unit: "m", format: "%.1f", size: [160, 36] });
    expect(model.sent[0]).toEqual({ type: "sync_request" });
    model.emit("msg:custom", { type: "snapshot", n: 4 }, [new DataView(new Float32Array([2, 5, 1, 3]).buffer)]);
    await tick();
    expect(el.querySelector(".awi-spark-line")).not.toBeNull();
    expect(el.querySelectorAll(".awi-spark-min, .awi-spark-max").length).toBe(2);
    expect(body.getAttribute("aria-label")).toBe("Level: last 3.0 m, min 1.0, max 5.0");
  });
});

describe("BarGraph (IND-102)", () => {
  it("draws one bar per entry, colored and labelled only in alarm", async () => {
    const { el, body } = await render({ label: "Zones", _kind: "bargraph", value: [62, 83.1], bars: [{ label: "Z1", normal_lo: 55, normal_hi: 70 }, { label: "Z2", hi: 80 }], min: 0, max: 100, unit: "°C", format: "%.1f", alarm_levels: ["normal", "hi"], deadband: 0, size: [200, 160] });
    expect(el.querySelectorAll(".awi-bar-track").length).toBe(2);
    expect(el.querySelectorAll(".awi-bar-alarm").length).toBe(1);
    expect(el.querySelector(".awi-bar-alarm").classList.contains("awi-bar-hi")).toBe(true);
    expect([...el.querySelectorAll(".awi-bar-value")].map((t) => t.textContent)).toEqual(["62.0", "83.1 HI"]);
    expect(body.getAttribute("aria-label")).toBe("Zones: Z1 62.0 °C, Z2 83.1 °C HI");
  });
});

describe("KPITile (IND-103)", () => {
  it("shows the difference to the target with direction and side", async () => {
    expect(kpiDelta(84.6, 85, true, "%.1f", "%")).toEqual({ good: false, text: "▼ -0.4 % vs target 85.0 % ✗" });
    expect(kpiDelta(3, 5, false, "%.0f", "min")).toEqual({ good: true, text: "▼ -2 min vs target 5 min ✓" });
    expect(kpiDelta(1, null, true, "%.1f", "")).toBeNull();
    const { el, body } = await render({ label: "OEE", _kind: "kpitile", value: 86.2, target: 85, higher_is_better: true, unit: "%", format: "%.1f", show_sparkline: true, history: 30, size: [170, 96] });
    expect(el.querySelector(".awi-kpi-value").textContent).toBe("86.2 %");
    expect(el.querySelector(".awi-kpi-delta").textContent).toBe("▲ +1.2 % vs target 85.0 % ✓");
    expect(el.querySelector(".awi-root").classList.contains("awi-kpi-good")).toBe(true);
    expect(body.getAttribute("aria-label")).toBe("OEE: 86.2 %, ▲ +1.2 % vs target 85.0 % on the good side");
  });
});

describe("NumericEntry keypad (IND-104)", () => {
  it("edits a draft", () => {
    expect(editDraft(null, "7")).toBe("7");
    expect(editDraft("0", "5")).toBe("5");
    expect(editDraft("", ".")).toBe("0.");
    expect(editDraft("1.2", ".")).toBe("1.2");
    expect(editDraft("12", "sign")).toBe("-12");
    expect(editDraft("-12", "sign")).toBe("12");
    expect(editDraft("12", "back")).toBe("1");
  });

  it("checks the range, confirms large changes and commits with Enter", async () => {
    const { model, el } = await render({ label: "Setpoint", mode: "control", _kind: "numericentry", value: 2.2, min: 0, max: 4, unit: "m", format: "%.2f", confirm_delta: 1, coerce: false, size: [180, 230] });
    const key = (name) => el.querySelector(`button[aria-label="${name}"]`);
    expect(el.querySelector(".awi-kp-display").textContent).toBe("2.20 m");
    key("9").click();
    key("Enter").click();
    await tick();
    expect(el.querySelector(".awi-kp-msg").textContent).toMatch(/Out of range/);
    expect(model.get("value")).toBe(2.2);
    key("Clear the entry").click();
    key("3").click();
    key("Decimal point").click();
    key("5").click();
    await tick();
    expect(el.querySelector(".awi-kp-display").textContent).toBe("3.5 m");
    key("Enter").click(); // 3.5 - 2.2 > confirm_delta: confirmation first
    await tick();
    expect(el.querySelector(".awi-kp-msg").textContent).toBe("Large change: press Enter again to set 3.50 m");
    expect(model.get("value")).toBe(2.2);
    key("Enter").click();
    expect(model.get("value")).toBe(3.5);
    expect(model.sent.at(-1)).toMatchObject({ value: 3.5 });
    // keyboard: digits then Escape discards
    const body = el.querySelector(".awi-body");
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await tick();
    expect(el.querySelector(".awi-kp-display").textContent).toBe("3.50 m");
  });
});
