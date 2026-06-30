import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html"], ["line"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Default E2E project: the full suite EXCEPT the a11y spec. The a11y spec
    // runs in its own always-on, DB-free CI lane (.github/workflows/a11y.yml) so
    // it must not be double-discovered/double-counted here in the DB-gated
    // `integration-e2e` lane (.github/workflows/ci.yml). `pnpm test:e2e` runs
    // this project only (it is listed first / is the non-a11y project).
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /a11y\.spec\.ts/,
    },
    // Accessibility-only project. The a11y CI lane targets it with
    // `--project=a11y`, so it runs ONLY a11y.spec.ts and never re-runs the rest
    // of the E2E suite (and the default `chromium` project never re-runs a11y).
    {
      name: "a11y",
      use: { ...devices["Desktop Chrome"] },
      testMatch: /a11y\.spec\.ts/,
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
