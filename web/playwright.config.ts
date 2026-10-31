import { defineConfig, devices } from "@playwright/test";

// The web against `cf dev --mode interop` (backend/dev/worker.ts): the real
// Worker, the web app and fake Kenni and Google providers. web.yml starts it;
// locally, start it as backend/README.md says and run `pnpm --filter
// spjall-web e2e`. The tests reach it through the web's real origin
// (e2e/origin.ts).
export default defineConfig({
  testDir: "e2e",
  forbidOnly: !!process.env.CI,
  retries: 0,
  // One person signing in costs about 8 s on a hosted runner, so Playwright's
  // default of 30 s is spent by three people on a slow day with no step stuck.
  // An `expect` that never holds still fails on its own 5 s.
  timeout: 60_000,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
