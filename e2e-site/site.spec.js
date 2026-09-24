// DOC-006: the in-browser deployments of the documentation site (marimo
// WebAssembly exports and JupyterLite) load the package wheel and render
// working widgets, for every demo notebook. Needs the built site in site/
// and network access (Pyodide and its packages come from a CDN): run by the
// Docs workflow.
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

const LOAD = { timeout: 240_000 };
const body = (page, label) => widget(page, label).locator(":scope > .awi-body");

async function nudge(page, label) {
  await body(page, label).scrollIntoViewIfNeeded();
  await body(page, label).focus();
  await page.keyboard.press("ArrowUp");
}

// One scenario per demo: something computed in Python must follow an input.
const DEMOS = {
  gallery: async (page, lite) => {
    const [control, indicator, start] = lite ? ["Knob (control)", "Gauge", "31"] : ["Setpoint", "Level", "61"];
    await expect(body(page, control)).toHaveAttribute("aria-valuenow", lite ? "30" : "60", LOAD);
    await nudge(page, control);
    await expect(body(page, indicator)).toHaveAttribute("aria-valuenow", start, { timeout: 30_000 });
  },
  pid_tuning: async (page) => {
    const text = widget(page, "Overshoot").locator(".awi-value");
    await expect(text).toHaveText(/%$/, LOAD);
    const before = await text.textContent();
    await nudge(page, "Kp");
    await expect(text).not.toHaveText(before, { timeout: 30_000 });
  },
  operator_station: async (page) => {
    const machine = widget(page, "Line state");
    await expect(machine.locator(".awi-sm-label-current")).toHaveText("▶ Stopped", LOAD);
    await machine.getByRole("button", { name: "Reset", exact: true }).click();
    // Resetting completes by itself on the simulation clock
    await expect(machine.locator(".awi-sm-label-current")).toHaveText("▶ Idle", { timeout: 30_000 });
  },
  signal_analysis: async (page) => {
    await expect(body(page, "Dominant frequency (Hz)")).toHaveAttribute("aria-valuenow", "50", LOAD);
    await nudge(page, "Frequency");
    await expect(body(page, "Dominant frequency (Hz)")).toHaveAttribute("aria-valuenow", "51", { timeout: 30_000 });
  },
};

for (const [name, scenario] of Object.entries(DEMOS)) {
  test(`marimo: ${name}`, async ({ page }) => {
    await page.goto(`/marimo/${name}/`);
    await scenario(page, false);
  });

  test(`JupyterLite: ${name}`, async ({ page }) => {
    await page.goto(`/lite/lab/index.html?path=${name}.ipynb`);
    await page.locator(".jp-Notebook").waitFor({ timeout: 120_000 });
    await expect(page.locator(".jp-Notebook-ExecutionIndicator[data-status='idle']")).toBeVisible(LOAD);
    await page.locator(".jp-Notebook").click();
    await page.keyboard.press("Escape");
    await page.getByRole("menuitem", { name: "Run", exact: true }).click();
    await page.getByRole("menuitem", { name: "Run All Cells", exact: true }).click();
    await scenario(page, true);
    await expect(page.locator(".jp-OutputArea-output[data-mime-type='application/vnd.jupyter.error']")).toHaveCount(0);
  });
}

test("marimo: the former address redirects to the gallery", async ({ page }) => {
  await page.goto("/marimo/");
  await expect(page).toHaveURL(/\/marimo\/gallery\/$/);
});
