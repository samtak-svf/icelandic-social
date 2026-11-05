// @ts-check
import { defineConfig } from "vitest/config";
import { vitestLoad } from "./tooling/vitest-load.mjs";

// Workers and timeouts follow free memory and the machine's load average
// (tooling/vitest-load.mjs, docs/testing.md "Where CI runs"). The tooling tests
// start child processes, so the base is 10 s, stretched up to 3x under load.
const load = vitestLoad({ baseTimeoutMs: 10_000 });
if (!process.env.CI && process.env.VITEST) process.stderr.write(`${load.line}\n`);

export default defineConfig({
  test: {
    experimental: { diagnostics: false },
    include: ["tooling/tests/**/*.test.mjs"],
    maxWorkers: load.maxWorkers,
    testTimeout: load.testTimeout,
    hookTimeout: load.hookTimeout,
  },
});
