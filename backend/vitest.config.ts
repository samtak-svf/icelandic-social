import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd with the real bindings from wrangler.jsonc, local
// and isolated per test file.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: { include: ["test/**/*.test.ts"] },
});
