// Documentation images of the batch reactor showcase (docs/img/showcase-reactor*.png).
// Refresh them whenever a widget of the showcase changes its drawing:
//
//   npm run build && pip install -e .
//   marimo run lite/marimo/batch_reactor.py --headless --port 2719 --no-token &
//   node js/scripts/docs-images.mjs [http://127.0.0.1:2719/]
//
// The script starts the reactor (Reset, Start) and waits until it runs, so
// that the pictures show a live process. The notebook images of the examples
// come from `AWI_SHOTS=docs/img npx playwright test e2e/examples.spec.js`.
import { chromium } from "@playwright/test";

const url = process.argv[2] || "http://127.0.0.1:2719/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 3600 }, deviceScaleFactor: 1 });
await page.goto(url);

const escape = (s) => s.replace(/[()]/g, "\\$&");
const widget = (label) => page.locator(".awi-root", { has: page.locator(":scope > .awi-label", { hasText: new RegExp(`^${escape(label)}$`) }) }).first();
const box = async (label) => {
  const b = await widget(label).boundingBox();
  if (!b) throw new Error(`widget not found: ${label}`);
  return b;
};

const machine = widget("R-101 state (PackML)");
await machine.getByRole("button", { name: "Reset", exact: true }).click({ timeout: 90_000 });
await page.waitForTimeout(3500);
await machine.getByRole("button", { name: "Start", exact: true }).click();
// Starting completes after two clock ticks; let the Fill phase advance
await page.locator(".awi-sm-label-current", { hasText: "Execute" }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(25_000);

const top = (await box("R-101 state (PackML)")).y - 30;
const left = Math.max(0, (await box("R-101 state (PackML)")).x - 20);
// crop to the right edge of the widgets
// (a locator: in marimo the widgets live in shadow roots)
const right = await page.locator(".awi-root").evaluateAll((els) => Math.max(...els.map((e) => e.getBoundingClientRect().right)));
const width = Math.min(1280, right + 20) - left;
// the whole operator station
const log = await box("Event log");
await page.screenshot({ path: "docs/img/showcase-reactor.png", clip: { x: left, y: top, width, height: log.y + log.height - top + 10 } });
// the hero image: state, process and operator actions
const reset = await box("Fault reset");
await page.screenshot({ path: "docs/img/showcase-reactor-hero.png", clip: { x: left, y: top, width, height: reset.y + reset.height - top + 10 } });
await browser.close();
