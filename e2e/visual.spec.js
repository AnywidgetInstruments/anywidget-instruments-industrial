// QA-004: visual regression of every widget, per style. Baselines live in
// e2e/visual.spec.js-snapshots; refresh them with
// `npx playwright test e2e/visual.spec.js --update-snapshots` after an
// intended visual change.
import { expect, test } from "@playwright/test";

for (const [name, query] of [["modern", "style=modern"], ["classic", "style=classic"], ["system-dark", "style=system&dark"], ["modern-theme-dark", "style=modern&theme=dark"]]) {
  test(`preview renders unchanged: ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.goto(`http://127.0.0.1:8766/js/preview/index.html?${query}&visual`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot(`preview-${name}.png`, { fullPage: true });
  });
}
