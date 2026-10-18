import { defineConfig } from "vitest/config";

// The web's unit tests, under Node: what they test takes its fetch as an
// argument. The browser itself is e2e/, under Playwright.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
