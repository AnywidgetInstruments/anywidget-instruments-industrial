// QA-005: performance benchmarks with regression thresholds
// (PERF-001, PERF-002, CHART-005). Results are attached to the test report.
import { expect, test } from "@playwright/test";
import { kernelExec, runNotebook, widget } from "./helpers.js";

const NB = "perf.ipynb";
const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

test("performance", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1400, height: 1200 });
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
  await kernelExec(page, NB, "probe_run()");
  await expect.poll(() => page.evaluate(() => Object.keys(window.__seen).length), { timeout: 20_000 }).toBeGreaterThanOrEqual(40);
  const stamps = JSON.parse(await kernelExec(page, NB, "import json; print(json.dumps(stamps))"));
  const seen = await page.evaluate(() => window.__seen);
  const latencies = Object.entries(stamps).map(([i, t]) => seen[i] - t).filter(Number.isFinite);

  // PERF-002 + CHART-005: load, while measuring input latency and frame rate
  await widget(page, "Perf chart").scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    window.__events = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.name === "keydown") window.__events.push(e.duration);
    }).observe({ type: "event", durationThreshold: 16, buffered: false });
    window.__frames = 0;
    window.__run = true;
    const tick = () => { window.__frames++; if (window.__run) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await kernelExec(page, NB, "load_run(4.0)");
  const t0 = Date.now();
  await widget(page, "Perf knob").locator(":scope > .awi-body").focus();
  const inputDelays = [];
  while (Date.now() - t0 < 4000) {
    const d = await page.evaluate(() => new Promise((resolve) => {
      const start = performance.now();
      const el = document.activeElement;
      el.addEventListener("keydown", () => requestAnimationFrame(() => resolve(performance.now() - start)), { once: true });
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    }));
    inputDelays.push(d);
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(100);
  }
  const elapsed = (Date.now() - t0) / 1000;
  const frames = await page.evaluate(() => { window.__run = false; return window.__frames; });
  const eventDurations = await page.evaluate(() => window.__events);

  const results = {
    "PERF-001 kernel->display latency ms (median, p95, max)": [pct(latencies, 50), pct(latencies, 95), Math.max(...latencies)],
    "PERF-002 input->next frame ms under load (median, p95, max)": [pct(inputDelays, 50), pct(inputDelays, 95), Math.max(...inputDelays)],
    "PERF-002 keydown Event Timing durations > 16 ms": eventDurations,
    "CHART-005 frames per second under 1 kHz load": frames / elapsed,
  };
  console.log(JSON.stringify(results, null, 1));
  await testInfo.attach("perf.json", { body: JSON.stringify(results, null, 2), contentType: "application/json" });

  expect(latencies.length).toBeGreaterThanOrEqual(35);
  expect(pct(latencies, 95)).toBeLessThan(50); // PERF-001
  expect(pct(inputDelays, 95)).toBeLessThan(100); // PERF-002
  expect(Math.max(0, ...eventDurations)).toBeLessThan(100); // PERF-002
  expect(frames / elapsed).toBeGreaterThanOrEqual(30); // CHART-005
});
