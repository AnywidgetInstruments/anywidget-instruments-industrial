// End-to-end tests (QA-003): kernel <-> front-end synchronization in
// JupyterLab and marimo. Requires the Python package installed in the active
// environment and the front-end bundle built (`npm run build`).
import { defineConfig } from "@playwright/test";

const PORT = 8899;

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  retries: 0,
  // one JupyterLab server and one workspace: run specs one at a time (also keeps
  // performance measurements free of concurrent load)
  workers: 1,
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  webServer: [
    {
      command:
        `jupyter lab --no-browser --port ${PORT} --IdentityProvider.token= --ServerApp.password= --allow-root ` +
        "--ServerApp.disable_check_xsrf=True --LabApp.news_url=None --LabApp.user_settings_dir=e2e/lab-settings --notebook-dir=e2e/notebooks",
      url: `http://localhost:${PORT}/lab`,
      env: { AWI_EXAMPLE_SECONDS: "30" }, // example simulations stop by themselves
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // marimo app used by e2e/marimo.spec.js (GEN-011)
      command: "marimo run --headless --port 2718 --no-token e2e/marimo/app.py",
      url: "http://localhost:2718",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      // static server for the widget preview page (e2e/visual.spec.js, QA-004)
      command: "python3 -m http.server 8766 --bind 127.0.0.1",
      url: "http://127.0.0.1:8766/js/preview/index.html",
      timeout: 30_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, threshold: 0.2, animations: "disabled" } },
});
