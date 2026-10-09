// @ts-check
// The Worker's deploy config, read once for every guard (jurisdiction-check,
// seam-guard). The guards see this model, never the file's own keys, so moving
// off Wrangler (decision 0031) changes this file and nothing that checks it.
//
// A key the model does not know is an error, not a skip: a new kind of binding
// would otherwise reach the Worker unseen by the seam guard.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./repo.mjs";
import { parseJsonc } from "./source.mjs";

const CONFIG_FILE = "backend/wrangler.jsonc";

/**
 * @typedef {{ pattern: string, customDomain: boolean }} Route
 * @typedef {{
 *   file: string,
 *   accountId: unknown,
 *   name: unknown,
 *   main: unknown,
 *   routes: Route[],
 *   workersDev: unknown,
 *   d1: { binding: string, name: unknown, id: unknown, migrationsDir: unknown }[],
 *   r2: { binding: string, bucket: unknown, jurisdiction: unknown }[],
 *   durableObjects: { binding: string, className: unknown }[],
 *   rateLimits: { binding: string, namespaceId: unknown }[],
 *   services: { binding: string }[],
 *   vars: Record<string, unknown>,
 *   crons: string[],
 *   queues: boolean,
 * }} WorkerConfig
 */

/** Keys that carry no binding and nothing a guard checks. */
const INERT = new Set(["$schema", "compatibility_date", "observability", "migrations"]);
/** Keys the model reads. */
const READ = new Set([
  "account_id",
  "name",
  "main",
  "routes",
  "workers_dev",
  "d1_databases",
  "r2_buckets",
  "durable_objects",
  "ratelimits",
  "kv_namespaces",
  "services",
  "vars",
  "triggers",
  "queues",
]);

/**
 * @param {any} raw the parsed Wrangler config
 * @param {string} [file] where it came from, for messages
 * @returns {WorkerConfig}
 */
export function normalise(raw, file = CONFIG_FILE) {
  const unknown = Object.keys(raw).filter((key) => !INERT.has(key) && !READ.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `${file}: ${unknown.join(", ")} not known to tooling/lib/worker-config.mjs; teach it there`,
    );
  }
  const list = (/** @type {unknown} */ value) => (Array.isArray(value) ? value : []);
  return {
    file,
    accountId: raw.account_id,
    name: raw.name,
    main: raw.main,
    routes: list(raw.routes).map((/** @type {any} */ r) =>
      typeof r === "string"
        ? { pattern: r, customDomain: false }
        : { pattern: r.pattern, customDomain: r.custom_domain === true },
    ),
    workersDev: raw.workers_dev,
    d1: list(raw.d1_databases).map((/** @type {any} */ d) => ({
      binding: d.binding,
      name: d.database_name,
      id: d.database_id,
      migrationsDir: d.migrations_dir,
    })),
    r2: list(raw.r2_buckets).map((/** @type {any} */ b) => ({
      binding: b.binding,
      bucket: b.bucket_name,
      jurisdiction: b.jurisdiction,
    })),
    durableObjects: list(raw.durable_objects?.bindings).map((/** @type {any} */ b) => ({
      binding: b.name,
      className: b.class_name,
    })),
    rateLimits: list(raw.ratelimits).map((/** @type {any} */ l) => ({
      binding: l.name,
      namespaceId: l.namespace_id,
    })),
    services: [...list(raw.kv_namespaces), ...list(raw.services)].map((/** @type {any} */ s) => ({
      binding: s.binding,
    })),
    vars: raw.vars ?? {},
    crons: list(raw.triggers?.crons),
    queues: raw.queues !== undefined,
  };
}

/**
 * @param {string} [root]
 * @returns {WorkerConfig}
 */
export function readWorkerConfig(root = ROOT) {
  return normalise(parseJsonc(readFileSync(join(root, CONFIG_FILE), "utf8")));
}

/**
 * Every name the Worker reads from `env` that the config declares.
 *
 * @param {WorkerConfig} config
 * @returns {string[]}
 */
export function configuredNames(config) {
  return [
    ...config.d1.map((d) => d.binding),
    ...config.r2.map((b) => b.binding),
    ...config.durableObjects.map((b) => b.binding),
    ...config.rateLimits.map((l) => l.binding),
    ...config.services.map((s) => s.binding),
    ...Object.keys(config.vars),
  ];
}
