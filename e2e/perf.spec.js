// QA-005: performance benchmarks with regression thresholds
// (PERF-001, PERF-002, CHART-005). Results are attached to the test report.
import { expect, test } from "@playwright/test";
import { kernelExec, runNotebook, widget } from "./helpers.js";

const NB = "perf.ipynb";
const PROBE_N = 100;
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

test("performance", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 1200 });
  // AWI_CPU_THROTTLE=4 emulates a slower machine (e.g. to reproduce CI numbers)
  if (process.env.AWI_CPU_THROTTLE) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(process.env.AWI_CPU_THROTTLE) });
  }
  await runNotebook(page, NB);
  await expect(widget(page, "Perf probe").locator(".awi-value")).toHaveText("0.0", { timeout: 60_000 });
  await widget(page, "Perf probe").scrollIntoViewIfNeeded();

  // PERF-001: kernel update -> displayed value (same host: shared wall clock)
  await page.evaluate(() => {
    window.__seen = {};
    const el = [...document.querySelectorAll(".awi-root")].find((r) => r.querySelector(":scope > .awi-label")?.textContent === "Perf probe");
    const value = el.querySelector(".awi-value");
    new MutationObserver(() => {
      const v = Number.parseFloat(value.textContent);
      if (!(v in window.__seen)) window.__seen[v] = Date.now();
    }).observe(value, { childList: true, characterData: true, subtree: true });
  });
  // 100 samples: with fewer, p95 is set by the one or two slowest updates
  // and a single scheduler hiccup on a shared CI runner decides the result
  await kernelExec(page, NB, `probe_run(${PROBE_N})`);
  // updates arriving within one frame are coalesced (PERF-003): wait for the last value
  await expect.poll(() => page.evaluate((n) => n in window.__seen, PROBE_N), { timeout: 30_000 }).toBe(true);
  const stamps = JSON.parse(await kernelExec(page, NB, "import json; print(json.dumps(stamps))"));
  const seen = await page.evaluate(() => window.__seen);
  const latencies = Object.entries(stamps).map(([i, t]) => seen[i] - t).filter(Number.isFinite);

  // PERF-002: 50 indicators at 20 Hz, while measuring input latency
  await widget(page, "Perf knob").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.__events = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === "keydown") window.__events.push(e.duration);
    }).observe({ type: "event", durationThreshold: 16, buffered: false });
  });
  // Sample ~40 key presses under load, so that the p95 is not the maximum.
  // The load runs long enough for a slow runner, where one press round trip
  // (evaluate + keyboard.press) can take ~0.7 s; the sampling stops at 40
  // presses. The thresholds below are unchanged.
  const LOAD_S = 20;
  await kernelExec(page, NB, `indicators_run(${LOAD_S}.0)`);
  let t0 = Date.now();
  await widget(page, "Perf knob").locator(":scope > .awi-body").focus();
  const inputDelays = [];
  let presses = 0;
  while (presses < 40 && Date.now() - t0 < (LOAD_S - 1) * 1000) {
    const d = await page.evaluate(() => new Promise((resolve) => {
      const start = performance.now();
      const el = document.activeElement;
      el.addEventListener("keydown", () => requestAnimationFrame(() => resolve(performance.now() - start)), { once: true });
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    }));
    inputDelays.push(d);
    await page.keyboard.press("ArrowUp");
    presses++;
    await page.waitForTimeout(50);
  }
  await kernelExec(page, NB, "indicators_stop.set()"); // the chart is measured without this load
  const eventDurations = await page.evaluate(() => window.__events);
  // the observer only reports events longer than 16 ms: the other presses
  // count as 16 ms (Event Timing durations are rounded to 8 ms)
  const allDurations = [...eventDurations, ...Array(Math.max(0, presses - eventDurations.length)).fill(16)];
  await page.waitForTimeout(500);

  // CHART-005: frame rate while the chart receives 1 kHz of samples
  await widget(page, "Perf chart").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.__frames = 0;
    window.__run = true;
    const tick = () => { window.__frames++; if (window.__run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await kernelExec(page, NB, "chart_run(4.0)");
  t0 = Date.now();
  await page.waitForTimeout(4000);
  const elapsed = (Date.now() - t0) / 1000;
  const frames = await page.evaluate(() => { window.__run = false; return window.__frames; });

  const results = {
    "PERF-001 kernel->display latency ms (median, p95, max)": [pct(latencies, 50), pct(latencies, 95), Math.max(...latencies)],
    "PERF-002 input->next frame ms under load (median, p95, max)": [pct(inputDelays, 50), pct(inputDelays, 95), Math.max(...inputDelays)],
    "PERF-002 keydown Event Timing durations > 16 ms": eventDurations,
    "PERF-002 keydown presses": presses,
    "CHART-005 frames per second with a 1 kHz chart feed": frames / elapsed,
  };
  console.log(JSON.stringify(results, null, 1));
  await testInfo.attach("perf.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });

  expect(latencies.length).toBeGreaterThanOrEqual(PROBE_N / 4);
  expect(pct(latencies, 95)).toBeLessThan(50); // PERF-001
  expect(pct(inputDelays, 95)).toBeLessThan(100); // PERF-002
  // PERF-002 on keyboard events: p95 below 100 ms, like the other latency
  // figures (a single event is at the mercy of the runner's scheduler);
  // no event may approach a visible freeze
  expect(presses).toBeGreaterThanOrEqual(20);
  expect(pct(allDurations, 95)).toBeLessThan(100); // PERF-002
  expect(Math.max(0, ...eventDurations)).toBeLessThan(250); // PERF-002
  expect(frames / elapsed).toBeGreaterThanOrEqual(30); // CHART-005
});
