import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journey against a production build (`npm run build` first).
 * Uses PayPal and AI FIXTURE modes and a throwaway database, so it proves the
 * product flow and access control, not the live PayPal integration. The live
 * sandbox run is documented separately in docs/VERIFICATION.md.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: { baseURL: "http://localhost:3200", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: "http://localhost:3200",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
