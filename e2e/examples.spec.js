// DOC-002 / DOC-004: every example notebook runs in JupyterLab without errors.
import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { runNotebook } from "./helpers.js";

const examples = readdirSync("examples").filter((f) => f.endsWith(".ipynb"));

for (const file of examples) {
  test(`example ${file} runs`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1400, height: 1000 });
    const name = `ex-${file}`;
    const content = JSON.parse(readFileSync(`examples/${file}`, "utf8"));
    await page.goto("/lab");
    await page.evaluate(async ({ name, content }) => {
      await fetch(`/api/contents/${name}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "notebook", format: "json", content }) });
    }, { name, content });
    await runNotebook(page, name);
    await expect(page.locator(".jp-Notebook-ExecutionIndicator[data-status='idle']")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(2000);
    await expect(page.locator(".awi-root").first()).toBeVisible();
    const errors = await page.locator(".jp-OutputArea-output[data-mime-type='application/vnd.jupyter.stderr']").allTextContents();
    expect(errors.filter((t) => /Traceback|Error/.test(t))).toEqual([]);
    await expect(page.locator(".jp-OutputArea-output .jp-RenderedText[data-mime-type='application/vnd.jupyter.error']")).toHaveCount(0);
    await page.locator(".jp-Cell-outputArea .awi-root").first().evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.waitForTimeout(500);
    const shot = await page.screenshot({ fullPage: false });
    await testInfo.attach(file.replace(".ipynb", ".png"), { body: shot, contentType: "image/png" });
    if (process.env.AWI_SHOTS) {
      // documentation images: the first widget output of the notebook
      const output = page.locator(".jp-OutputArea-output", { has: page.locator(".awi-root") }).first();
      await output.screenshot({ path: `${process.env.AWI_SHOTS}/${file.replace(".ipynb", ".png")}` });
    }
  });
}
