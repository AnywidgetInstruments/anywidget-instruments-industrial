import { expect, test } from "@playwright/test";
import { widget } from "./helpers.js";

test("marimo: reactive re-execution and liveness", async ({ page }) => {
  await page.goto("http://localhost:2718/");
  const knob = widget(page, "Marimo knob"); // locators pierce marimo's shadow DOM
  const double = widget(page, "Marimo double");
  await expect(knob.locator(".awi-value")).toHaveText("10.0", { timeout: 30_000 });
  await expect(double.locator(".awi-body")).toHaveAttribute("aria-valuenow", "20");

  // GEN-011: changing the control re-executes the dependent cell
  await knob.locator(".awi-body").focus();
  await page.keyboard.press("ArrowUp");
  await expect(double.locator(".awi-body")).toHaveAttribute("aria-valuenow", "22");

  // binary chart data reach the front end
  await expect(widget(page, "Marimo chart").locator(".awi-body")).toHaveAttribute("aria-label", /latest 0\.5\b/);

  // ROB-001: heartbeats flow in marimo too (no false stale indication)
  await page.waitForTimeout(12_000);
  await expect(knob).not.toHaveClass(/awi-stale/);
});
