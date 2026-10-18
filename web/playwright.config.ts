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
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
