// @ts-check
import { describe, expect, it } from "vitest";
import { configuredNames, normalise, readWorkerConfig } from "../lib/worker-config.mjs";

describe("worker-config", () => {
  it("normalises every kind of binding the Worker uses", () => {
    const config = normalise({
      $schema: "x",
      name: "w",
      account_id: "a",
      main: "src/index.ts",
      compatibility_date: "2026-01-01",
      routes: ["h/*", { pattern: "h", custom_domain: true }],
      workers_dev: false,
      d1_databases: [{ binding: "DB", database_name: "d", database_id: "i", migrations_dir: "m" }],
      r2_buckets: [{ binding: "R", bucket_name: "b", jurisdiction: "eu" }],
      durable_objects: { bindings: [{ name: "NS", class_name: "C" }] },
      exports: {
        C: { type: "durable-object", storage: "sqlite" },
        Old: { type: "durable-object", state: "deleted" },
        W: { type: "workflow" },
      },
      ratelimits: [{ name: "L", namespace_id: "1", simple: { limit: 1, period: 60 } }],
      kv_namespaces: [{ binding: "KV", id: "k" }],
      services: [{ binding: "SVC", service: "s" }],
      triggers: { crons: ["0 0 * * *"] },
      vars: { V: "1" },
    });
    expect(config.routes).toEqual([
      { pattern: "h/*", customDomain: false },
      { pattern: "h", customDomain: true },
    ]);
    expect(config.d1).toEqual([{ binding: "DB", name: "d", id: "i", migrationsDir: "m" }]);
    expect(config.r2).toEqual([{ binding: "R", bucket: "b", jurisdiction: "eu" }]);
    expect(config.durableObjects).toEqual([{ binding: "NS", className: "C" }]);
    expect(config.classes).toEqual([
      { className: "C", storage: "sqlite", state: "created" },
      { className: "Old", storage: undefined, state: "deleted" },
    ]);
    expect(config.legacyMigrations).toBe(false);
    expect(config.crons).toEqual(["0 0 * * *"]);
    expect(config.queues).toBe(false);
    expect(configuredNames(config).sort()).toEqual(["DB", "KV", "L", "NS", "R", "SVC", "V"]);
  });

  it("refuses a key it does not know, so no binding kind goes unseen", () => {
    expect(() => normalise({ name: "w", hyperdrive: [{ binding: "H" }] })).toThrow(
      /hyperdrive not known to tooling\/lib\/worker-config\.mjs/,
    );
  });

  it("reads the real config with every binding the Worker reads", () => {
    const names = configuredNames(readWorkerConfig());
    for (const name of ["DB", "MEDIA", "CONVERSATION", "INBOX", "PUBLIC_LIMIT", "CLAIM_LIMIT"]) {
      expect(names).toContain(name);
    }
  });
});
