// TrendChart front end (IND-070..075).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import widget from "../src/index.js";
import { PenRing, parseTime, timeLabel, timeTicks } from "../src/widgets/trend.js";
import { common, fakeModel } from "./helpers.js";

const tick = () => new Promise((r) => setTimeout(r, 30));
let texts;
let saved;
beforeEach(() => {
  // jsdom has no canvas: record the texts drawn
  texts = [];
  saved = HTMLCanvasElement.prototype.getContext;
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : k === "measureText" ? () => ({ width: 10 }) : k === "fillText" ? (s) => texts.push(s) : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = () => ctx;
});
afterEach(() => { HTMLCanvasElement.prototype.getContext = saved; });

describe("PenRing", () => {
  it("keeps the newest samples and interpolates in time", () => {
    const r = new PenRing(3);
    r.push(new Float64Array([1, 2, 3, 4]), new Float32Array([10, 20, 30, 40]), 4);
    expect(r.size).toBe(3);
    expect([r.first, r.last]).toEqual([2, 4]);
    expect(r.at(3.5)).toBeCloseTo(35);
    expect(r.at(1)).toBeNaN();
    expect(r.lowerBound(3)).toBe(1);
  });
});

describe("time axis", () => {
  it("chooses round steps and formats local times", () => {
    const t0 = new Date(2026, 0, 1, 10, 0, 7).getTime() / 1000;
    const { step, ticks } = timeTicks(t0, t0 + 600, 5);
    expect(step).toBe(120);
    expect(timeLabel(ticks[0], step)).toBe("10:02");
    expect(timeLabel(t0, 10)).toBe("10:00:07");
    expect(ticks.length).toBeLessThanOrEqual(6);
  });
  it("parses typed times", () => {
    const ref = new Date(2026, 0, 1, 12, 0, 0).getTime() / 1000;
    expect(parseTime("10:30", ref)).toBe(new Date(2026, 0, 1, 10, 30).getTime() / 1000);
    expect(parseTime("2025-12-31 23:59:30", ref)).toBe(new Date(2025, 11, 31, 23, 59, 30).getTime() / 1000);
    expect(parseTime("25:00", ref)).toBeNaN();
    expect(parseTime("soon", ref)).toBeNaN();
  });
});

function trendModel() {
  return fakeModel({ ...common, label: "Trend", mode: "indicator", _kind: "trendchart", pens: [{ name: "LT", unit: "m", min: 0, max: 4, hi: 3 }, { name: "FT", unit: "L/s", min: 0, max: 60 }], span: 600, history: 100, value: { LT: 2, FT: 30 }, size: [480, 220], cursors: [], cursor_values: [], annotations: [], export: true, x_unit: "", unit: "" });
}

function snapshot(model, t) {
  const buf = (Type, values) => new DataView(new Type(values).buffer);
  model.emit("msg:custom", { type: "snapshot", pens: [[0, 3, 3], [1, 2, 2]] }, [
    buf(Float64Array, [t, t + 10, t + 20]), buf(Float32Array, [1, 1.5, 2]),
    buf(Float64Array, [t, t + 20]), buf(Float32Array, [20, 30]),
  ]);
}

describe("TrendChart view", () => {
  it("requests the history, follows live data and browses the history (IND-071, IND-072)", async () => {
    const model = trendModel();
    const el = document.createElement("div");
    const view = widget.render({ model, el }) || null;
    expect(model.sent[0]).toEqual({ type: "sync_request" });
    const t = 1_800_000_000;
    snapshot(model, t);
    await tick();
    expect(texts).toContain("● LIVE");
    expect(el.querySelector(".awi-body").getAttribute("aria-label")).toBe("Trend: LT 2 m, FT 30 L/s");
    // legend: one button per pen, the first gives the scale
    const pens = [...el.querySelectorAll("button.awi-pen")];
    expect(pens.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false"]);
    pens[1].click();
    await tick();
    expect(pens[1].getAttribute("aria-pressed")).toBe("true");
    // browse back: history mode, then Live returns
    texts = [];
    el.querySelector('[aria-label="Earlier"]').click();
    await tick();
    expect(texts).toContain("❚❚ HISTORY");
    expect(el.querySelector(".awi-body").getAttribute("aria-label")).toContain("(history)");
    texts = [];
    el.querySelector('[aria-label="Follow the latest data"]').click();
    await tick();
    expect(texts).toContain("● LIVE");
    void view;
  });

  it("appends samples and changes the span from the toolbar", async () => {
    const model = trendModel();
    const el = document.createElement("div");
    widget.render({ model, el });
    const t = 1_800_000_000;
    snapshot(model, t);
    model.emit("msg:custom", { type: "append", pens: [[0, 1, 4]] }, [new DataView(new Float64Array([t + 30]).buffer), new DataView(new Float32Array([2.5]).buffer)]);
    await tick();
    const select = el.querySelector('select[aria-label="Time span"]');
    expect([...select.options].map((o) => o.textContent)).toEqual(["1 min", "10 min", "1 h", "8 h", "24 h"]);
    expect(select.value).toBe("600");
    select.value = "3600";
    select.dispatchEvent(new Event("change"));
    expect(model.get("span")).toBe(3600);
    expect(model.sent.at(-1)).toMatchObject({ span: 3600 });
  });
});
