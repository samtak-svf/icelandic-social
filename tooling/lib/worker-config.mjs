// @ts-check
// The Worker's deploy config, read once for every guard (jurisdiction-check,
// seam-guard). The guards see this model, never the file's own keys, so a
// change of config format changes this file and nothing that checks it.
//
// The config is backend/cloudflare.config.ts (decision 0032). It is imported,
// not parsed: Node strips its types, and `defineConfig` returns plain data, or
// a factory of the mode that is called here the way `cf deploy` calls it (no
// mode).
//
// A key or binding type the model does not know is an error, not a skip: a new
// kind of binding would otherwise reach the Worker unseen by the seam guard.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./repo.mjs";

const CONFIG_FILE = "backend/cloudflare.config.ts";

/**
 * @typedef {{ pattern: string, customDomain: boolean }} Route
 * @typedef {{
 *   file: string,
 *   accountId: unknown,
 *   name: unknown,
 *   main: unknown,
 *   routes: Route[],
 *   workersDev: unknown,
 *   d1: { binding: string, name: unknown, id: unknown }[],
 *   r2: { binding: string, bucket: unknown, jurisdiction: unknown }[],
 *   durableObjects: { binding: string, className: unknown, worker: unknown }[],
 *   classes: { className: string, storage: unknown, state: unknown }[],
 *   rateLimits: { binding: string, namespaceId: unknown }[],
 *   services: { binding: string }[],
 *   vars: Record<string, unknown>,
 *   crons: string[],
 *   queues: boolean,
 * }} WorkerConfig
 */

/** Top-level keys. */
const ROOT_KEYS = new Set(["accountId", "worker"]);
/** Worker keys that carry no binding and nothing a guard checks. */
const INERT = new Set(["compatibilityDate", "observability"]);
/** Worker keys the model reads. */
const READ = new Set([
  "name",
  "entrypoint",
  "domains",
  "routes",
  "workersDev",
  "triggers",
  "env",
  "exports",
]);

/**
 * @param {string} file
 * @param {string[]} unknown
 */
const refuse = (file, unknown) =>
  new Error(
    `${file}: ${unknown.join(", ")} not known to tooling/lib/worker-config.mjs; teach it there`,
  );

/**
 * Files one `env` binding into the model.
 *
 * @param {WorkerConfig} config
 * @param {string} binding
 * @param {any} b
 * @returns {boolean} false for a type the model does not know
 */
function addBinding(config, binding, b) {
  switch (b?.type) {
    case "text":
    case "json":
      config.vars[binding] = b.value;
      return true;
    case "d1":
      config.d1.push({ binding, name: b.name, id: b.id });
      return true;
    case "r2":
      config.r2.push({ binding, bucket: b.name, jurisdiction: b.jurisdiction });
      return true;
    case "durable-object":
      config.durableObjects.push({ binding, className: b.exportName, worker: b.worker });
      return true;
    case "rate-limit":
      config.rateLimits.push({ binding, namespaceId: b.namespace });
      return true;
    case "queue":
      config.queues = true;
      config.services.push({ binding });
      return true;
    case "kv":
    case "worker":
    case "images":
      config.services.push({ binding });
      return true;
    default:
      return false;
  }
}

/**
 * @param {any} worker
 * @returns {Route[]}
 */
const routesOf = (worker) => [
  ...(worker.routes ?? []).map((/** @type {any} */ r) => ({
    pattern: typeof r === "string" ? r : r.pattern,
    customDomain: false,
  })),
  ...(worker.domains ?? []).map((/** @type {string} */ d) => ({ pattern: d, customDomain: true })),
];

/**
 * @param {any} worker
 * @returns {WorkerConfig["classes"]}
 */
const classesOf = (worker) =>
  Object.entries(worker.exports ?? {})
    .filter(([, e]) => /** @type {any} */ (e).type === "durable-object")
    .map(([className, /** @type {any} */ e]) => ({
      className,
      storage: e.storage,
      state: e.state ?? "created",
    }));

/**
 * @param {any} raw the resolved default export of cloudflare.config.ts
 * @param {string} [file] where it came from, for messages
 * @returns {WorkerConfig}
 */
export function normalise(raw, file = CONFIG_FILE) {
  const worker = raw.worker ?? {};
  const unknown = [
    ...Object.keys(raw).filter((key) => !ROOT_KEYS.has(key)),
    ...Object.keys(worker).filter((key) => !INERT.has(key) && !READ.has(key)),
  ];
  if (unknown.length > 0) throw refuse(file, unknown);

  /** @type {WorkerConfig} */
  const config = {
    file,
    accountId: raw.accountId,
    name: worker.name,
    main: worker.entrypoint,
    routes: routesOf(worker),
    workersDev: worker.workersDev,
    d1: [],
    r2: [],
    durableObjects: [],
    classes: classesOf(worker),
    rateLimits: [],
    services: [],
    vars: {},
    crons: [],
    queues: false,
  };

  const unknownTypes = Object.entries(worker.env ?? {})
    .filter(([binding, b]) => !addBinding(config, binding, b))
    .map(([binding, b]) => `env.${binding} (${/** @type {any} */ (b)?.type})`);
  for (const t of worker.triggers ?? []) {
    if (t.type === "scheduled") config.crons.push(t.schedule);
    else if (t.type === "queue") config.queues = true;
    else unknownTypes.push(`trigger ${t.type}`);
  }
  if (unknownTypes.length > 0) throw refuse(file, unknownTypes);
  return config;
}

/**
 * @param {any} value a config value, promise or factory of the context
 * @param {{ mode: string | undefined, isPreview: boolean }} ctx
 */
const resolve = async (value, ctx) => (typeof value === "function" ? value(ctx) : value);

/**
 * @param {string} [root]
 * @param {string} [mode] the `--mode` cf is run with; none for a deploy
 * @returns {Promise<WorkerConfig>}
 */
export async function readWorkerConfig(root = ROOT, mode = undefined) {
  const ctx = { mode, isPreview: false };
  const module = await import(pathToFileURL(join(root, CONFIG_FILE)).href);
  const raw = await resolve(module.default, ctx);
  return normalise({ ...raw, worker: await resolve(raw.worker, ctx) });
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
