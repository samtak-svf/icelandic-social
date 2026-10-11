// @ts-check
import { describe, expect, it } from "vitest";
import { configuredNames, normalise, readWorkerConfig } from "../lib/worker-config.mjs";

describe("worker-config", () => {
  it("normalises every kind of binding the Worker uses", () => {
    const config = normalise({
      accountId: "a",
      worker: {
        name: "w",
        entrypoint: "src/index.ts",
        compatibilityDate: "2026-01-01",
        domains: ["h"],
        routes: ["h/*"],
        workersDev: false,
        triggers: [{ type: "scheduled", schedule: "0 0 * * *" }],
        env: {
          V: { type: "text", value: "1" },
          DB: { type: "d1", name: "d", id: "i" },
          R: { type: "r2", name: "b", jurisdiction: "eu" },
          NS: { type: "durable-object", worker: "w", exportName: "C" },
          L: { type: "rate-limit", namespace: "1", simple: { limit: 1, period: 60 } },
          KV: { type: "kv", id: "k" },
          SVC: { type: "worker", worker: "s" },
          IMG: { type: "images" },
        },
        exports: {
          C: { type: "durable-object", storage: "sqlite" },
          Old: { type: "durable-object", state: "deleted" },
          W: { type: "workflow" },
        },
      },
    });
    expect(config.main).toBe("src/index.ts");
    expect(config.routes).toEqual([
      { pattern: "h/*", customDomain: false },
      { pattern: "h", customDomain: true },
    ]);
    expect(config.d1).toEqual([{ binding: "DB", name: "d", id: "i" }]);
    expect(config.r2).toEqual([{ binding: "R", bucket: "b", jurisdiction: "eu" }]);
    expect(config.durableObjects).toEqual([{ binding: "NS", className: "C", worker: "w" }]);
    expect(config.classes).toEqual([
      { className: "C", storage: "sqlite", state: "created" },
      { className: "Old", storage: undefined, state: "deleted" },
    ]);
    expect(config.crons).toEqual(["0 0 * * *"]);
    expect(config.queues).toBe(false);
    expect(configuredNames(config).sort()).toEqual(["DB", "IMG", "KV", "L", "NS", "R", "SVC", "V"]);
  });

  it("refuses a key or a binding type it does not know, so no binding goes unseen", () => {
    expect(() => normalise({ worker: { name: "w", limits: {} } })).toThrow(
      /limits not known to tooling\/lib\/worker-config\.mjs/,
    );
    expect(() => normalise({ worker: { env: { H: { type: "hyperdrive", id: "h" } } } })).toThrow(
      /env\.H \(hyperdrive\) not known/,
    );
  });

  it("sees a queue as a binding and as a trigger", () => {
    const bound = normalise({ worker: { env: { Q: { type: "queue", name: "q" } } } });
    expect(bound.queues).toBe(true);
    expect(configuredNames(bound)).toEqual(["Q"]);
    const consumer = normalise({ worker: { triggers: [{ type: "queue", queue: "q" }] } });
    expect(consumer.queues).toBe(true);
  });

  it("reads the real config with every binding the Worker reads", async () => {
    const names = configuredNames(await readWorkerConfig());
    for (const name of [
      "DB",
      "MEDIA",
      "PROFILES",
      "IMAGES",
      "CONVERSATION",
      "INBOX",
      "PUBLIC_LIMIT",
      "CLAIM_LIMIT",
      "PHOTO_LIMIT",
    ]) {
      expect(names).toContain(name);
    }
  });
});
