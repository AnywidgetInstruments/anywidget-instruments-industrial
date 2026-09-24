// DOC-006: the in-browser deployments of the documentation site (marimo
// WebAssembly export and JupyterLite) load the package wheel and render
// working widgets. Needs the built site in site/ and network access
// (Pyodide and its packages come from a CDN): run by the Docs workflow.
import { expect, test } from "@playwright/test";
import { widget } from "../e2e/helpers.js";

test.setTimeout(300_000);

// Browser console and page text in the job log: the in-browser Python
// runtimes report their errors there.
test.beforeEach(async ({ page }) => {
  page.on("console", (m) => console.log(`[browser ${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => console.log(`[page error] ${e.message}`));
});
test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    console.log(`[page text]\n${await page.locator("body").innerText().catch(() => "")}`);
  }
});

test("marimo WebAssembly export", async ({ page }) => {
  await page.goto("/marimo/");
  const setpoint = widget(page, "Setpoint");
  await expect(setpoint.locator(".awi-value")).toHaveText(/^60\.0\b/, { timeout: 240_000 });
  const level = widget(page, "Level").locator(":scope > .awi-body");
  await expect(level).toHaveAttribute("aria-valuenow", "60");
  // GEN-011: the dependent cell re-runs in the browser
  await setpoint.locator(".awi-body").focus();
  await page.keyboard.press("ArrowUp");
  await expect(level).toHaveAttribute("aria-valuenow", "61", { timeout: 30_000 });
});

test("JupyterLite gallery", async ({ page }) => {
  await page.goto("/lite/lab/index.html?path=gallery.ipynb");
  await page.locator(".jp-Notebook").waitFor({ timeout: 120_000 });
  await expect(page.locator(".jp-Notebook-ExecutionIndicator[data-status='idle']")).toBeVisible({ timeout: 240_000 });
  await page.locator(".jp-Notebook").click();
  await page.keyboard.press("Escape");
  await page.getByRole("menuitem", { name: "Run", exact: true }).click();
  await page.getByRole("menuitem", { name: "Run All Cells", exact: true }).click();
  const knob = widget(page, "Knob (control)");
  await expect(knob.locator(".awi-value")).toHaveText(/^30/, { timeout: 240_000 });
  await knob.scrollIntoViewIfNeeded();
  await knob.locator(":scope > .awi-body").focus();
  await page.keyboard.press("ArrowUp");
  // kernel callback in Pyodide: knob -> gauge
  await expect(widget(page, "Gauge").locator(":scope > .awi-body")).toHaveAttribute("aria-valuenow", "31", { timeout: 30_000 });
});
