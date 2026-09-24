import { expect, test } from "@playwright/test";
import { runNotebook, widget } from "./helpers.js";

test("kernel <-> front end synchronization in JupyterLab", async ({ page }) => {
  await runNotebook(page, "sync.ipynb");

  const knob = widget(page, "E2E knob");
  const gauge = widget(page, "E2E gauge");
  const led = widget(page, "E2E led");
  const echo = widget(page, "E2E echo");

  // initial state and kernel -> front end update after display
  await expect(knob.locator(".awi-value")).toHaveText("10.0");
  await expect(gauge.locator(".awi-value")).toHaveText("77.0");
  await expect(led).not.toHaveClass(/awi-on/);

  // front end -> kernel (keyboard control), then kernel -> front end echo
  await knob.locator(".awi-body").focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(knob.locator(".awi-value")).toHaveText("12.0");
  await expect(led).toHaveClass(/awi-on/);
  await expect(echo.locator(".awi-body")).toHaveAttribute("aria-valuenow", "12");

  // WaveformChart: samples appended by the kernel arrive as binary buffers
  const chart = widget(page, "E2E chart");
  await expect(chart.locator(".awi-body")).toHaveAttribute("aria-label", /latest 0\.5\b/);

  // PictureControl: batched drawing rendered, clicks sent to the kernel
  const pic = widget(page, "E2E picture");
  const canvas = pic.locator("canvas");
  await canvas.scrollIntoViewIfNeeded(); // off-screen widgets skip rendering (PERF-005)
  await expect
    .poll(() => canvas.evaluate((c) => Array.from(c.getContext("2d").getImageData(10 * devicePixelRatio, 10 * devicePixelRatio, 1, 1).data)))
    .toEqual([255, 0, 0, 255]);
  await canvas.click({ position: { x: 120, y: 40 } });
  await expect(widget(page, "E2E clicks").locator(".awi-body")).toHaveAttribute("aria-valuenow", "120");
});

test("stale-data indication after a kernel restart (ROB-001)", async ({ page }) => {
  await runNotebook(page, "stale.ipynb");
  const knob = widget(page, "Stale knob");
  await expect(knob.locator(".awi-value")).toHaveText("10.0");
  await page.waitForTimeout(1500);
  await expect(knob).not.toHaveClass(/awi-stale/);
  await page.getByRole("menuitem", { name: "Kernel", exact: true }).click();
  await page.getByRole("menuitem", { name: /^Restart Kernel/ }).first().click();
  await page.getByRole("button", { name: "Confirm Kernel Restart" }).click();
  await expect(knob).toHaveClass(/awi-stale/, { timeout: 15_000 });
  await expect(knob.locator(".awi-stale-badge")).toContainText("STALE");
  await knob.locator(".awi-body").focus();
  await page.keyboard.press("ArrowUp");
  await expect(knob.locator(".awi-value")).toHaveText("10.0");
});
