import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// Tests run inside workerd with the real bindings from wrangler.jsonc, local
// and isolated per test file. The entry is test/worker.ts, the real Worker
// with its Durable Object stubs checked for the EU jurisdiction, which local
// workerd cannot pin. test/setup.ts applies the D1 migrations to each file's
// database.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./test/worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") },
      },
    })),
  ],
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
});
