// @ts-check
// EU residency of the Worker's storage (decision 0001, plan §4).
//
// A jurisdiction can only be set when a D1 database or R2 bucket is created,
// and a deploy that provisions a missing one creates it WITHOUT it. So two
// checks, because neither can see what the other can:
//
// `node tooling/jurisdiction-check.mjs`         offline, in `pnpm check`:
//     the Worker config names exactly the frozen ids, every R2 binding says
//     jurisdiction "eu", the account is Samtak's own, no Queues, and the APNs
//     vars match the Apple ids.
// `node tooling/jurisdiction-check.mjs --live`  CI and deploy, read-only token:
//     asks the Cloudflare REST API whether the D1 database the config
//     binds (by its id) and every R2 bucket it binds exist IN the EU
//     jurisdiction. Needs CLOUDFLARE_JURISDICTION_TOKEN (D1 Read, Workers R2
//     Storage Read).
// `node tooling/jurisdiction-check.mjs --deploy`  before `cf deploy`:
//     the config could be deployed without anything being provisioned: D1
//     has its id, the entry is src/index.ts, the Worker answers only on the
//     frozen API host as a custom domain, and workers.dev is off. The deploy
//     also runs with --no-provision (backend/package.json).
//
// Durable Objects are not checked here: a namespace has no jurisdiction the
// API can report. Each object id is pinned in code instead
// (tooling/seam-guard.mjs).
//
// The config is read through tooling/lib/worker-config.mjs, never parsed here.

import { readJson } from "./lib/repo.mjs";
import { readWorkerConfig } from "./lib/worker-config.mjs";

/** Samtak's own Cloudflare account (AGENTS.md § Infrastructure, decision 0031). */
export const SAMTAK_ACCOUNT = "af4d4a9c4527ce1e46d0c2dc1165e801";
const API = "https://api.cloudflare.com/client/v4";

/**
 * @typedef {import("./lib/worker-config.mjs").WorkerConfig} WorkerConfig
 */

/**
 * @param {WorkerConfig} config
 * @param {any} cloudflare the `cloudflare` block of identifiers/ids.json
 * @returns {string[]} problems, empty when the config is right
 */
export function checkConfig(config, cloudflare) {
  /** @type {string[]} */
  const problems = [];
  const expect = (
    /** @type {unknown} */ actual,
    /** @type {unknown} */ wanted,
    /** @type {string} */ what,
  ) => {
    if (actual !== wanted)
      problems.push(`${what} is ${JSON.stringify(actual)}, frozen id is ${JSON.stringify(wanted)}`);
  };

  expect(config.accountId, SAMTAK_ACCOUNT, "account id");
  expect(config.name, cloudflare.worker, "Worker name");

  expect(config.d1.length, 1, "number of D1 databases");
  expect(config.d1[0]?.name, cloudflare.d1, "D1 database name");

  const frozenBuckets = new Set(Object.values(cloudflare.r2));
  for (const bucket of config.r2) {
    if (!frozenBuckets.has(bucket.bucket)) {
      problems.push(`R2 bucket ${bucket.bucket} is not a frozen id`);
    }
    expect(bucket.jurisdiction, cloudflare.jurisdiction, `R2 ${bucket.binding} jurisdiction`);
  }

  const classes = config.durableObjects.map((b) => String(b.className));
  expect(
    classes.sort().join(","),
    Object.values(cloudflare.durableObjects).sort().join(","),
    "DO classes",
  );

  // Each DO binding is to a class of this Worker.
  for (const b of config.durableObjects) {
    expect(b.worker, cloudflare.worker, `DO ${b.binding} Worker`);
  }

  // Every live class is declared in `exports` as sqlite (decision 0032): a
  // deploy that dropped a class from `exports` would delete its namespace.
  const live = config.classes.filter((c) => c.state === "created");
  expect(
    live
      .map((c) => c.className)
      .sort()
      .join(","),
    Object.values(cloudflare.durableObjects).sort().join(","),
    "DO classes declared in exports",
  );
  for (const c of live) expect(c.storage, "sqlite", `DO ${c.className} storage`);

  if (config.queues) problems.push("Queues have no jurisdiction and are ruled out (decision 0001)");
  return problems;
}

/**
 * The APNs vars name the team and the bundle id that one Apple team owns:
 * the interim ones (decision 0011) or Samtak's own once it exists (0010).
 *
 * @param {WorkerConfig} config
 * @param {any} ids identifiers/ids.json
 * @returns {string[]} problems, empty when the vars are right
 */
export function checkApns(config, ids) {
  /** @type {string[]} */
  const problems = [];
  const own = ids.services.appleTeamId;
  const pairs = [{ team: ids.appleInterim.teamId, topic: ids.appleInterim.iosBundleId }];
  if (own) pairs.push({ team: own, topic: ids.store.iosBundleId });
  const { APNS_TEAM_ID: team, APNS_TOPIC: topic, APPLE_TEAM_ID: linkTeam } = config.vars;
  const pair = pairs.find((p) => p.team === team);
  if (!pair) {
    const teams = pairs.map((p) => JSON.stringify(p.team)).join(" or ");
    problems.push(`APNS_TEAM_ID is ${JSON.stringify(team)}, expected ${teams}`);
  } else if (topic !== pair.topic) {
    problems.push(
      `APNS_TOPIC is ${JSON.stringify(topic)}, team ${pair.team} pushes to ${pair.topic}`,
    );
  }
  // The link host's association files name the app of the store bundle id,
  // which only Samtak's own team signs.
  if (linkTeam !== "" && linkTeam !== own) {
    problems.push(`APPLE_TEAM_ID is ${JSON.stringify(linkTeam)}, expected "" or ${own}`);
  }
  return problems;
}

/**
 * @typedef {(url: string, init: { headers: Record<string, string> }) => Promise<{ status: number, json(): Promise<any> }>} Fetch
 */

/**
 * What `cf deploy` needs so it creates nothing by itself: a missing D1 id
 * would provision a database without a jurisdiction (decision 0001), and
 * dev/worker.ts, with its fake Kenni, must never be the deployed entry.
 *
 * @param {WorkerConfig} config
 * @param {any} ids identifiers/ids.json
 * @returns {string[]} problems, empty when the config can be deployed
 */
export function checkDeployable(config, ids) {
  /** @type {string[]} */
  const problems = [];
  const id = config.d1[0]?.id;
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id)) {
    problems.push(`D1 ${ids.cloudflare.d1} has no id; create it with --jurisdiction eu first`);
  }
  if (config.main !== "src/index.ts") {
    problems.push(`entrypoint is ${JSON.stringify(config.main)}, expected "src/index.ts"`);
  }
  const routes = JSON.stringify(config.routes);
  const wanted = JSON.stringify([{ pattern: ids.hosts.api, customDomain: true }]);
  if (routes !== wanted) problems.push(`routes is ${routes}, expected ${wanted}`);
  if (config.workersDev !== false) problems.push("workersDev must be false");
  return problems;
}

/**
 * @param {{ accountId: string, token: string, config: WorkerConfig, cloudflare: any, fetch: Fetch }} options
 * @returns {Promise<{ ok: string[], problems: string[] }>}
 */
export async function checkLive({ accountId, token, config, cloudflare, fetch }) {
  /** @type {string[]} */
  const ok = [];
  /** @type {string[]} */
  const problems = [];
  const get = async (
    /** @type {string} */ path,
    /** @type {Record<string, string>} */ extra = {},
  ) => {
    const response = await fetch(`${API}/accounts/${accountId}${path}`, {
      headers: { authorization: `Bearer ${token}`, ...extra },
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  };
  const want = cloudflare.jurisdiction;

  // The database the Worker binds, by id: another database of the same name
  // (say one recreated in the EU) would otherwise pass while the Worker still
  // writes to the old one.
  const id = config.d1[0]?.id;
  if (typeof id !== "string") {
    problems.push(`D1 ${cloudflare.d1}: ${config.file} has no database id`);
  } else {
    const detail = await get(`/d1/database/${encodeURIComponent(id)}`);
    const db = detail.body.result;
    if (detail.status !== 200 || !db) {
      problems.push(`D1 ${cloudflare.d1}: ${id} not found (status ${detail.status})`);
    } else if (db.name !== cloudflare.d1) {
      problems.push(`D1 ${id}: is named ${JSON.stringify(db.name)}, not ${cloudflare.d1}`);
    } else {
      (db.jurisdiction === want ? ok : problems).push(
        `D1 ${cloudflare.d1}: jurisdiction ${JSON.stringify(db.jurisdiction)}`,
      );
    }
  }

  // The buckets the Worker binds. A frozen name nothing binds (spjall-artifacts,
  // retired by decision 0013) is not storage this Worker writes to.
  for (const { bucket } of config.r2) {
    // Without this header an EU bucket is invisible, so a 404 means the bucket
    // is missing or was created outside the EU.
    const found = await get(`/r2/buckets/${bucket}`, { "cf-r2-jurisdiction": want });
    const actual = found.body.result?.jurisdiction;
    if (found.status === 200 && actual === want) ok.push(`R2 ${bucket}: jurisdiction "${want}"`);
    else
      problems.push(`R2 ${bucket}: not found in jurisdiction "${want}" (status ${found.status})`);
  }
  return { ok, problems };
}

async function main() {
  const config = await readWorkerConfig();
  const ids = readJson("identifiers/ids.json");
  const { cloudflare } = ids;
  const problems = [...checkConfig(config, cloudflare), ...checkApns(config, ids)];
  if (process.argv.includes("--deploy")) problems.push(...checkDeployable(config, ids));

  if (process.argv.includes("--live") && problems.length === 0) {
    const token = process.env.CLOUDFLARE_JURISDICTION_TOKEN;
    if (!token) {
      console.error("❌ --live needs CLOUDFLARE_JURISDICTION_TOKEN (read-only: D1 Read, R2 Read)");
      process.exit(1);
    }
    const live = await checkLive({
      accountId: String(config.accountId),
      token,
      config,
      cloudflare,
      fetch: globalThis.fetch,
    });
    for (const line of live.ok) console.log(`✓ ${line}`);
    problems.push(...live.problems);
  }

  if (problems.length === 0) {
    console.log("✓ storage is pinned to the EU jurisdiction under the frozen names");
    return;
  }
  for (const problem of problems) console.error(`::error file=${config.file}::${problem}`);
  console.error(`
Every D1 database and R2 bucket is created with --jurisdiction eu, which can
never be added later (AGENTS.md § Infrastructure, docs/decisions/0001).`);
  process.exit(1);
}

if (import.meta.main) await main();
