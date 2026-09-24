// Smoke tests of the built documentation site (e2e-site/, DOC-006).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e-site",
  retries: 0,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:8767", trace: "retain-on-failure" },
  webServer: {
    command: "python3 -m http.server 8767 --bind 127.0.0.1 --directory site",
    url: "http://127.0.0.1:8767/index.html",
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
});
