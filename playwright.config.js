import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

process.env.DECKFORGE_CONFIG_DIR ||= path.join(os.tmpdir(), "deckforge-e2e-no-config");

export default defineConfig({
  testDir: "test/e2e",
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // The editor must also work in WebKit hosts (Safari, Tauri WKWebView).
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
      testMatch: ["editor.spec.js", "no-srcdoc.spec.js", "viewer.spec.js"],
    },
  ],
});
