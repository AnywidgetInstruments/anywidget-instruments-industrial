// Widgets hosted without a Python kernel (HOST-001 .. HOST-004): a plain
// dictionary of traits built from the class defaults, as KaimonSlate.jl's
// SlateAFM does, in a real browser with the built bundle.
import { expect, test } from "@playwright/test";

const URL = "http://127.0.0.1:8766/e2e/host/index.html";
const widget = (page, label) => page.locator(".awi-root").filter({ has: page.locator(":scope > .awi-label", { hasText: label }) });

test("a trait dictionary renders bounded values and alarms, without NO KERNEL", async ({ page }) => {
  await page.clock.install();
  await page.goto(URL);
  await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
  const knob = widget(page, "Hostless knob");
  const tank = widget(page, "Hostless tank");

  // bounded: value 150 with coerce is shown at max, the alarm computed by the front end
  await expect(knob.locator(":scope > .awi-body")).toHaveAttribute("aria-valuenow", "100");
  await expect(knob).toHaveClass(/awi-alarm-hi/);
  await expect(knob.locator(".awi-badge")).toHaveText("HI");
  expect(await page.evaluate(() => window.models.knob.get("alarm_level"))).toBe("hi");
  await expect(tank).toHaveClass(/awi-indicator/);
  await expect(tank).toHaveClass(/awi-alarm-hi/);

  // a value pushed by the host: hysteresis applied by the front end
  await page.evaluate(() => window.models.knob.push("value", 87));
  await page.clock.runFor(100);
  await expect(knob).toHaveClass(/awi-alarm-hi/);
  await page.evaluate(() => window.models.knob.push("value", 80));
  await page.clock.runFor(100);
  await expect(knob).not.toHaveClass(/awi-alarm-hi/);
  expect(await page.evaluate(() => window.models.knob.saved.at(-1).alarm_level)).toBe("normal");

  // no heartbeat announced: never stale, however long it runs
  await page.clock.runFor(60_000);
  await expect(knob).not.toHaveClass(/awi-stale/);
  await expect(knob.locator(".awi-stale-badge")).toBeHidden();
  await expect(tank.locator(".awi-stale-badge")).toBeHidden();
});
