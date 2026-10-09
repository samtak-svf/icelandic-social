import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { workerConfig } from "./scripts/worker-config.ts";

// Tests run inside workerd with the real bindings from cloudflare.config.ts,
// local and isolated per test file. The entry is test/worker.ts, the real
// Worker with its Durable Object stubs checked for the EU jurisdiction, which
// local workerd cannot pin. test/setup.ts applies the D1 migrations to each
// file's database.
export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      main: "./test/worker.ts",
      experimental: { newConfig: { configPath: "./cloudflare.config.ts" } },
      miniflare: {
        durableObjects: await ownDurableObjects(),
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations("./migrations"),
          // The fake Kenni and Google that test/worker.ts serves, and a key
          // for the HMAC that guards nothing real.
          KENNI_ISSUER: "https://spjall.test/dev/kenni",
          GOOGLE_ISSUER: "https://spjall.test/dev/google",
          GOOGLE_CLIENT_ID: "fake-google-client",
          KENNITALA_HMAC_KEY: "test-only-kennitala-key",
        },
      },
    })),
  ],
  test: { include: ["test/**/*.test.ts"], setupFiles: ["./test/setup.ts"] },
});

/**
 * The config's Durable Object bindings to this Worker's own classes, as
 * Miniflare designators. A cf config names the Worker on every DO binding
 * (`worker: "spjall-api"`), and @cloudflare/vitest-plugin 1.4.0 reads a named
 * Worker as another one, which does not exist in the test. Re-declaring the
 * same bindings without the name, derived from the config so the two cannot
 * drift, makes them the test Worker's own.
 */
async function ownDurableObjects() {
  const worker = await workerConfig();
  const own: Record<string, { className: string; useSQLite: boolean }> = {};
  for (const [binding, value] of Object.entries(worker.env)) {
    if (value.type !== "durable-object" || value.worker !== worker.name || !value.exportName)
      continue;
    const declared = worker.exports[value.exportName];
    own[binding] = {
      className: value.exportName,
      useSQLite: declared?.type === "durable-object" && declared.storage === "sqlite",
    };
  }
  return own;
}
