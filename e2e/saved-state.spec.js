// ROB-004: a notebook saved with widget state and reopened without its
// kernel renders the last values as read-only widgets.
import { expect, test } from "@playwright/test";
import { runNotebook, widget } from "./helpers.js";

const NB = "saved-state.ipynb";
const notebook = {
  cells: [{ cell_type: "code", execution_count: null, id: "s0", metadata: {}, outputs: [], source: "import anywidget_instruments as ai\nai.set_heartbeat(1)\nai.Knob(33, label='Saved knob')" }],
  metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
};

test("saved widget state renders read-only without the kernel", async ({ page }) => {
  await page.goto("/lab");
  await page.evaluate(async ({ NB, notebook }) => {
    await fetch(`/api/contents/${NB}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "notebook", format: "json", content: notebook }) });
  }, { NB, notebook });
  await runNotebook(page, NB);
  const knob = widget(page, "Saved knob");
  await expect(knob.locator(".awi-value")).toHaveText("33.0");
  await page.keyboard.press("Control+s");
  // while the file is being written the contents API may answer without
  // content: poll until the saved notebook carries the widget state
  await expect.poll(async () => {
    const nb = await page.evaluate(async (NB) => (await fetch(`/api/contents/${NB}`)).json(), NB);
    return JSON.stringify(nb?.content?.metadata?.widgets ?? {}).includes("Saved knob");
  }, { timeout: 15_000 }).toBe(true);

  // shut the kernel down, then reopen the notebook
  await page.evaluate(async () => {
    for (const s of await (await fetch("/api/sessions")).json()) await fetch(`/api/sessions/${s.id}`, { method: "DELETE" });
  });
  await page.goto(`/lab/tree/${NB}?reset`);
  const restored = widget(page, "Saved knob");
  await expect(restored.locator(".awi-value")).toHaveText("33.0", { timeout: 30_000 });
  await expect(restored.locator(".awi-stale-badge")).toContainText("NO KERNEL", { timeout: 20_000 });
  await restored.locator(":scope > .awi-body").focus();
  await page.keyboard.press("ArrowUp");
  await expect(restored.locator(".awi-value")).toHaveText("33.0");
});
