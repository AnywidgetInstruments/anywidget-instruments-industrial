import { expect, test } from "@playwright/test";
import { runNotebook, widget } from "./helpers.js";

test("graphs: cursors, zoom, export, intensity and digital rendering", async ({ page }) => {
  await runNotebook(page, "graphs.ipynb");
  const chart = widget(page, "E2E graph");
  const canvas = chart.locator("canvas");
  await canvas.scrollIntoViewIfNeeded();
  const echo = widget(page, "E2E cursor value").locator(".awi-body");
  await expect(echo).toHaveAttribute("aria-valuenow", "20");

  // CHART-104: drag the cursor; the kernel recomputes the value under it
  // plot area: x from 52 to 408 px for x in [0, 100)
  const xOf = (v) => 52 + (v / 100) * (420 - 52 - 12);
  await canvas.hover({ position: { x: xOf(20), y: 100 } });
  await page.mouse.down();
  await canvas.hover({ position: { x: xOf(60), y: 100 } });
  await page.mouse.up();
  await expect.poll(async () => Number(await echo.getAttribute("aria-valuenow"))).toBeGreaterThan(55);

  // CHART-106: zoom tool, then double-click restores the full view
  await chart.getByRole("button", { name: "Zoom tool: drag a rectangle" }).click();
  await canvas.hover({ position: { x: xOf(70), y: 40 } });
  await page.mouse.down();
  await canvas.hover({ position: { x: xOf(90), y: 150 } });
  await page.mouse.up();
  const before = await canvas.screenshot();
  await canvas.dblclick({ position: { x: xOf(80), y: 100 } });
  await expect.poll(async () => Buffer.compare(before, await canvas.screenshot())).not.toBe(0);

  // CHART-107: CSV export
  const [dl] = await Promise.all([page.waitForEvent("download"), chart.getByRole("button", { name: "Download data as CSV" }).click()]);
  const csv = await (await dl.createReadStream()).toArray();
  const text = Buffer.concat(csv).toString();
  expect(text.split("\n")[0]).toBe("x,trace 0");
  expect(text.split("\n")).toHaveLength(101);

  // CHART-101 / CHART-102 rendering
  const spec = widget(page, "E2E intensity");
  await spec.scrollIntoViewIfNeeded();
  await expect(spec.locator(".awi-body")).toHaveAttribute("aria-label", /50 rows/);
  await expect(widget(page, "E2E digital").locator(".awi-body")).toHaveAttribute("aria-label", /3 lines, 5 samples/);
});
