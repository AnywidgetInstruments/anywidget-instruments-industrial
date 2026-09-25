// GEN-003: rendering and synchronization in Jupyter Notebook 7 (served by
// the same Jupyter server as JupyterLab).
import { expect, test } from "@playwright/test";
import { kernelExec, widget } from "./helpers.js";

test("Notebook 7: render and synchronize", async ({ page }) => {
  // start from a fresh kernel, as runNotebook does in JupyterLab: sessions
  // left by earlier tests (a kernel restart, sessions being deleted) could
  // keep Notebook 7 "Connecting"
  for (const s of await (await page.request.get("/api/sessions")).json()) await page.request.delete(`/api/sessions/${s.id}`);
  await page.goto("/notebooks/sync.ipynb");
  await page.locator(".jp-Notebook").waitFor();
  const select = page.locator(".jp-Dialog").getByRole("button", { name: "Select", exact: true });
  await expect(page.locator(".jp-Notebook-ExecutionIndicator[data-status='idle'], #jp-kernel-status, .jp-KernelStatus").first()).toBeVisible({ timeout: 60_000 });
  const knob = widget(page, "E2E knob");
  // The kernel dialog can appear late and swallow "Run All Cells" (nothing
  // runs): dismiss it whenever it shows, and run again only if execution did
  // not start (as runNotebook does in JupyterLab).
  const prompts = page.locator(".jp-CodeCell .jp-InputPrompt, .jp-CodeCell .jp-OutputPrompt");
  const started = async () => (await prompts.allTextContents()).some((t) => /\[(\d+|\*)\]/.test(t));
  for (let attempt = 0; attempt < 3 && !(await started()); attempt++) {
    if (await select.isVisible().catch(() => false)) await select.click();
    await page.getByRole("menuitem", { name: "Run", exact: true }).click();
    await page.getByRole("menuitem", { name: "Run All Cells", exact: true }).click();
    await expect.poll(started, { timeout: 10_000 }).toBe(true).catch(() => {});
  }
  await expect(knob.locator(".awi-value")).toHaveText("10.0", { timeout: 60_000 });
  await knob.locator(":scope > .awi-body").focus();
  await page.keyboard.press("ArrowUp");
  await expect(knob.locator(".awi-value")).toHaveText("11.0");
  await expect.poll(() => kernelExec(page, "sync.ipynb", "print(knob.value, led.value)")).toBe("11.0 True");
  await kernelExec(page, "sync.ipynb", "knob.value = 55");
  await expect(knob.locator(".awi-value")).toHaveText("55.0");
});
