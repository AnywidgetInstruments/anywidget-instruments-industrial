import { expect, test } from "@playwright/test";
import { runNotebook, widget } from "./helpers.js";

test("SCADA objects: synoptic children, faceplate commands, alarm banner", async ({ page }) => {
  await runNotebook(page, "scada.ipynb");

  // SCADA-010: widgets nested in the synoptic canvas through the widget manager
  const syn = widget(page, "E2E synoptic");
  await expect(syn.locator(".awi-synoptic-item")).toHaveCount(3);
  await expect(widget(page, "E2E nested tank").locator(".awi-value")).toHaveText("40.0");
  await expect(syn.locator(".awi-pipe-fluid.awi-flowing")).toHaveCount(1);

  // SCADA-009: faceplate command -> kernel -> simulated state + callback
  const pump = widget(page, "E2E pump");
  await expect(pump.locator(".awi-process-state")).toHaveText("STOPPED · MAN");
  await pump.locator(".awi-body").click();
  await pump.getByRole("dialog").getByRole("button", { name: "Start" }).click();
  await expect(pump.locator(".awi-process-state")).toHaveText("RUNNING · MAN");
  await expect(widget(page, "E2E running")).toHaveClass(/awi-on/);

  // SCADA-006/007: banner acknowledgement reaches the kernel
  const banner = widget(page, "E2E banner");
  await banner.scrollIntoViewIfNeeded();
  await expect(banner.locator("tbody tr")).toHaveCount(1);
  await banner.getByRole("button", { name: "Acknowledge TK-1.HI" }).click();
  await expect(banner.locator("tbody tr").first()).toContainText("ACTIVE · ACK");
  await expect(widget(page, "E2E acked")).toHaveClass(/awi-on/);
});
