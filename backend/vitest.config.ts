import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { vitestLoad } from "../tooling/vitest-load.mjs";
import { workerConfig } from "./scripts/worker-config.ts";

// Workers and timeouts follow free memory and the machine's load average
// (tooling/vitest-load.mjs, docs/testing.md "Where CI runs"). The base is the
// 15 s this suite always had; load stretches it up to 3x, never below it.
const load = vitestLoad({ baseTimeoutMs: 15_000 });
if (!process.env.CI && process.env.VITEST) process.stderr.write(`${load.line}\n`);

// wrangler prints "Using secrets defined in ..." and a missing-secrets warning once per
// test file (94 times a run). Both are log-level chatter from its dev-vars loader: "error"
// would hide real warnings too, so keep "warn" and satisfy the one it raises, with the same
// test-only key the bindings below already hand the Worker.
process.env.WRANGLER_LOG ??= "warn";
process.env.KENNITALA_HMAC_KEY ??= "test-only-kennitala-key";

// workerd reports a few harmless events on its own stdout/stderr, which the pool writes
// straight to the process streams (not through console, so `onConsoleLog` cannot reach them):
// - "SQLite alarm overdue, running despite AlarmManager mismatch": our Durable Objects arm
//   `setAlarm(Date.now())` to run a job at once, workerd's alarm manager then sees its clock a
//   few milliseconds past the stored time, runs the alarm anyway and says so. The alarm ran.
// - "SQLite alarm handler canceled with requestScheduledAlarm": an alarm that re-arms itself
//   while running, or whose test file ended, replaces the pending run, as designed.
// - "exception = ...: disconnected: ..." and its "stack:" line: a pipe or stream closing
//   when a test file's isolate is torn down.
// No code of ours can prevent these, so exactly these lines are dropped; every other line
// (including a real workerd warning) still prints.
const HARMLESS_WORKERD =
  /SQLite alarm overdue, running despite AlarmManager mismatch|SQLite alarm handler canceled with requestScheduledAlarm|^exception = .*: disconnected: |^stack: .*workerd@/;
if (process.env.VITEST) {
  for (const stream of [process.stdout, process.stderr]) {
    const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      if (typeof chunk !== "string" || !HARMLESS_WORKERD.test(chunk)) return write(chunk, ...rest);
      // Line by line, so a chunk that batches these with other output keeps the rest.
      const kept = chunk.split("\n").filter((line) => !HARMLESS_WORKERD.test(line));
      return kept.join("\n").trim() === "" ? true : write(kept.join("\n"), ...rest);
    }) as typeof stream.write;
  }
}

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
          // The maintainer's token for /ops (decision 0068), test-only.
          OPS_TOKEN: "test-only-ops-token-0123456789abcdef",
        },
      },
    })),
  ],
  test: {
    // The end-of-run tip to set `isolate: false` stays off: each file's own D1, R2 and
    // Durable Object storage is what the suite relies on, so reusing workers is not safe.
    experimental: { diagnostics: false },
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    // Every expect.poll here waits for a Durable Object alarm that fires on
    // its own, so the default 1 s is a guess that istanbul instrumentation on
    // a loaded runner can miss. A poll that passes returns on its first
    // success, so the budget costs nothing when the state arrives. The test
    // timeout must exceed it, or it is the 5 s default that cuts a poll short.
    expect: { poll: { timeout: 10_000, interval: 50 } },
    testTimeout: load.testTimeout,
    hookTimeout: load.hookTimeout,
    maxWorkers: load.maxWorkers,
    // `pnpm coverage` turns this on; the workers pool supports istanbul, not v8.
    // tooling/coverage-floor.mjs reads the summary (docs/testing.md).
    coverage: {
      provider: "istanbul",
      include: ["src/**"],
      reporter: ["json-summary", "text-summary"],
      reportsDirectory: "../coverage/backend",
    },
  },
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
