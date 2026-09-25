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
  // Read the file only once JupyterLab reports the save as finished: a read
  // that meets the half-written file makes the server restore its backup,
  // which can lose the notebook. An answer that is not JSON (an error while
  // the file is replaced) counts as "not yet".
  await expect(page.locator(".lm-TabBar-tab.jp-mod-dirty")).toHaveCount(0, { timeout: 15_000 });
  await expect.poll(async () => {
    const text = await page.evaluate(async (NB) => {
      const res = await fetch(`/api/contents/${NB}`);
      return res.ok ? res.text() : "";
    }, NB);
    try {
      return JSON.stringify(JSON.parse(text)?.content?.metadata?.widgets ?? {}).includes("Saved knob");
    } catch {
      return false;
    }
  }, { timeout: 15_000, intervals: [500, 1000] }).toBe(true);

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
