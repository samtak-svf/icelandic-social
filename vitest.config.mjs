// @ts-check
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tooling/tests/**/*.test.mjs"],
  },
});
