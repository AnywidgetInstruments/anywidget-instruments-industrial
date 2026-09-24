// Transmitter front end (IND-080..083).
import { describe, expect, it } from "vitest";
import widget from "../src/index.js";
import { splitTag } from "../src/widgets/transmitter.js";
import { common, fakeModel } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 30));
const txModel = (extra = {}) =>
  fakeModel({ ...common, label: "", mode: "indicator", _kind: "transmitter", value: 2.4, min: 0, max: 4, step: 0, unit: "m", scale: "linear", ticks: 5, minor_ticks: 4, format: "%.2f", coerce: false, update_rate: 30, entry: true, animate: false, animation_ms: 0, lolo: null, lo: null, hi: 3, hihi: null, deadband: 0, show_limits: false, alarm_level: "normal", tag: "LT-101", status: "ok", status_text: "", size: [110, 84], ...extra });

describe("Transmitter", () => {
  it("splits tags into function letters and loop number", () => {
    expect(splitTag("LT-101")).toEqual(["LT", "101"]);
    expect(splitTag("PT101A")).toEqual(["PT", "101A"]);
    expect(splitTag("")).toEqual(["", ""]);
  });

  it("draws the bubble, the value and the status as text and shape (IND-080, IND-081)", async () => {
    const model = txModel({ status: "maintenance", status_text: "sensor drift" });
    const el = document.createElement("div");
    widget.render({ model, el });
    await tick();
    const texts = [...el.querySelectorAll("svg text")].map((t) => t.textContent);
    expect(texts).toEqual(expect.arrayContaining(["LT", "101", "◆"]));
    expect(el.querySelector(".awi-ne107-symbol-maintenance rect")).not.toBeNull();
    expect(el.querySelector(".awi-tx-status").textContent).toBe("◆ MAINTENANCE · sensor drift");
    const body = el.querySelector(".awi-body");
    expect(body.getAttribute("aria-label")).toBe("LT-101");
    expect(body.getAttribute("aria-valuetext")).toBe("2.40 m, maintenance: sensor drift");
    expect(el.querySelector(".awi-value").textContent).toBe("2.40 m");
  });

  it("marks the value invalid on failure (IND-082)", async () => {
    const model = txModel();
    const el = document.createElement("div");
    widget.render({ model, el });
    await tick();
    expect(el.querySelector(".awi-tx-status").textContent).toBe("OK");
    model.set("status", "failure");
    model.emit("change:status");
    await tick();
    expect(el.querySelector(".awi-value").textContent).toBe("✕ BAD");
    const body = el.querySelector(".awi-body");
    expect(body.hasAttribute("aria-valuenow")).toBe(false);
    expect(body.getAttribute("aria-valuetext")).toBe("invalid value, device failure");
    expect(el.querySelector(".awi-root").classList.contains("awi-ne107-failure")).toBe(true);
  });
});
