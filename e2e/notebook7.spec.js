// GEN-003: rendering and synchronization in Jupyter Notebook 7 (served by
// the same Jupyter server as JupyterLab).
import { expect, test } from "@playwright/test";
import { kernelExec, widget } from "./helpers.js";

test("Notebook 7: render and synchronize", async ({ page }) => {
  await page.goto("/notebooks/sync.ipynb");
  await page.locator(".jp-Notebook").waitFor();
  const select = page.locator(".jp-Dialog").getByRole("button", { name: "Select", exact: true });
  if (await select.isVisible({ timeout: 3000 }).catch(() => false)) await select.click();
  await expect(page.locator(".jp-Notebook-ExecutionIndicator[data-status='idle'], #jp-kernel-status, .jp-KernelStatus").first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1000);
  await page.getByRole("menuitem", { name: "Run", exact: true }).click();
  await page.getByRole("menuitem", { name: "Run All Cells", exact: true }).click();
  const knob = widget(page, "E2E knob");
  await expect(knob.locator(".awi-value")).toHaveText("10.0", { timeout: 60_000 });
  await knob.locator(":scope > .awi-body").focus();
  await page.keyboard.press("ArrowUp");
  await expect(knob.locator(".awi-value")).toHaveText("11.0");
  await expect.poll(() => kernelExec(page, "sync.ipynb", "print(knob.value, led.value)")).toBe("11.0 True");
  await kernelExec(page, "sync.ipynb", "knob.value = 55");
  await expect(knob.locator(".awi-value")).toHaveText("55.0");
});
