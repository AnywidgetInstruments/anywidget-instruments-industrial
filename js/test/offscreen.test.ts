// PERF-002 / PERF-005: a widget scrolled out of view keeps its DOM state
// (value text, ARIA) current, but at most once every OFFSCREEN_MS, not once
// per update: a kernel updating fifty hidden gauges at 20 Hz must not cost
// a thousand DOM updates a second.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import widget from "../src/index.js";
import { BaseView, OFFSCREEN_MS } from "anywidget-instruments/js/src/core/view.js";
import { CONTRACTS } from "../src/generated/contract.js";

let observers: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: (entries: Array<{ isIntersecting: boolean }>) => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("off-screen updates are coalesced, and the last value is shown", async () => {
  const traits: Record<string, unknown> = Object.fromEntries(Object.entries(CONTRACTS.Gauge.traits).map(([k, s]) => [k, s.default]));
  const handlers: Record<string, Array<() => void>> = {};
  const model = {
    get: (k: string) => traits[k],
    set: (k: string, v: unknown) => void (traits[k] = v),
    save_changes() {},
    send() {},
    on: (ev: string, cb: () => void) => void (handlers[ev] ||= []).push(cb),
    off() {},
  };
  const el = document.createElement("div");
  document.body.appendChild(el);
  widget.initialize?.({ model });
  widget.render({ model, el });
  await vi.advanceTimersByTimeAsync(40);
  for (const cb of observers) cb([{ isIntersecting: false }]); // scrolled out of view
  const spy = vi.spyOn(BaseView.prototype, "renderCommon");
  for (let i = 1; i <= 20; i++) {
    traits.value = i;
    for (const h of handlers["change:value"] || []) h();
  }
  expect(spy).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(OFFSCREEN_MS);
  expect(spy).toHaveBeenCalledTimes(1);
  expect(el.querySelector(".awi-value")?.textContent).toContain("20");
  expect(el.querySelector(".awi-body")?.getAttribute("aria-valuenow")).toBe("20");
});
