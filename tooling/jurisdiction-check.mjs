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
// `node tooling/jurisdiction-check.mjs --staging`  before a staging deploy:
//     staging's D1 has its id. With --live, the same questions about staging's
//     own D1 and buckets.
//
// Offline, on every run, the staging Worker (decision 0118): its storage is its
// own and in the EU, it binds nothing of production's, its gate is declared and
// covers static files. And the other way: production's entry is src/index.ts,
// with workers.dev off and no staging name, and a dev entry or a fake issuer
// reaches no mode but interop and staging.
//
// Durable Objects are not checked here: a namespace has no jurisdiction the
// API can report. Each object id is pinned in code instead
// (tooling/seam-guard.mjs).
//
// The config is read through tooling/lib/worker-config.mjs, never parsed here.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, ROOT } from "./lib/repo.mjs";
import { readWorkerConfig } from "./lib/worker-config.mjs";

/** Samtak's own Cloudflare account (AGENTS.md § Infrastructure, decision 0031). */
export const SAMTAK_ACCOUNT = "af4d4a9c4527ce1e46d0c2dc1165e801";
const API = "https://api.cloudflare.com/client/v4";

/**
 * The cloud regions inside the EU a targeted placement may name. London
 * (aws:eu-west-2, gcp:europe-west2) and Zurich (aws:eu-central-2,
 * gcp:europe-west6) carry "eu" or "europe" in their names and are outside it.
 */
const EU_REGIONS = new Set([
  "aws:eu-central-1",
  "aws:eu-west-1",
  "aws:eu-west-3",
  "aws:eu-south-1",
  "aws:eu-south-2",
  "aws:eu-north-1",
  "gcp:europe-west1",
  "gcp:europe-west3",
  "gcp:europe-west4",
  "gcp:europe-west8",
  "gcp:europe-west9",
  "gcp:europe-north1",
]);

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

  // The Worker runs in a named cloud region next to D1 (decision 0056), and
  // only in one inside the EU: Smart Placement may leave it at the edge.
  const region = /** @type {any} */ (config.placement)?.region;
  if (!EU_REGIONS.has(region)) {
    problems.push(
      `placement is ${JSON.stringify(config.placement)}, expected { region } in the EU, next to D1`,
    );
  }
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
  const {
    APNS_TEAM_ID: team,
    APNS_TOPIC: topic,
    APPLE_TEAM_ID: linkTeam,
    ANDROID_CERT_SHA256: certs,
  } = config.vars;
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
  // Android compares these byte for byte, so any other spelling fails verification without a word.
  const fingerprint = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;
  for (const cert of String(certs ?? "")
    .split(",")
    .filter(Boolean)) {
    if (!fingerprint.test(cert)) problems.push(`ANDROID_CERT_SHA256 holds ${JSON.stringify(cert)}`);
  }
  return problems;
}

/**
 * @typedef {(url: string, init: { headers: Record<string, string> }) => Promise<{ status: number, json(): Promise<any> }>} Fetch
 */

/**
 * What `cf deploy` needs so it creates nothing by itself: a missing D1 id
 * would provision a database without a jurisdiction (decision 0001), and
 * no dev entry, with its fake Kenni, may be production's.
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

/** The modes with a dev entry; a mode not named here must be production's config. */
const DEV_ENTRIES = new Map([
  ["interop", "dev/worker.ts"],
  ["staging", "dev/staging.ts"],
]);
/** The modes a person or a tool would plausibly pass, besides none at all. */
const OTHER_MODES = [undefined, "production", "preview", "development", "test"];
/** The only secrets staging declares: its own HMAC key, and its gate. */
const STAGING_SECRETS = ["KENNITALA_HMAC_KEY", "STAGING_GATE"];

/** Every name a staging resource has in ids.json. */
const stagingNames = (/** @type {any} */ cloudflare) => [
  cloudflare.staging.worker,
  cloudflare.staging.d1,
  ...Object.values(cloudflare.staging.r2),
];

/** Every name of a resource a config binds, and its own. */
const boundNames = (/** @type {WorkerConfig} */ config) => [
  config.name,
  ...config.d1.map((d) => d.name),
  ...config.r2.map((b) => b.bucket),
  ...config.durableObjects.map((b) => b.worker),
];

/**
 * What must hold of production's config in any mode that is not a dev one: not
 * only at a deploy, since a wrong mode is wrong before anyone deploys it.
 *
 * @param {WorkerConfig} config
 * @param {any} ids identifiers/ids.json
 * @returns {string[]} problems, empty when nothing of staging or the fakes is in it
 */
export function checkProduction(config, ids) {
  /** @type {string[]} */
  const problems = [];
  if (config.main !== "src/index.ts") {
    problems.push(`entrypoint is ${JSON.stringify(config.main)}, expected "src/index.ts"`);
  }
  if (config.workersDev !== false) problems.push("workersDev must be false");
  const staging = new Set(stagingNames(ids.cloudflare));
  for (const name of new Set(boundNames(config))) {
    if (staging.has(name)) problems.push(`production binds the staging name ${name}`);
  }
  if (config.secrets.includes("STAGING_GATE")) problems.push("production declares STAGING_GATE");
  for (const name of ["KENNI_ISSUER", "GOOGLE_ISSUER"]) {
    if (String(config.vars[name]).includes("/dev/")) {
      problems.push(`${name} is a fake issuer: ${JSON.stringify(config.vars[name])}`);
    }
  }
  if (String(config.vars.GOOGLE_CLIENT_ID).startsWith("fake-")) {
    problems.push("GOOGLE_CLIENT_ID is a fake client");
  }
  return problems;
}

/**
 * A dev entry reaches interop and staging and no other mode.
 *
 * @param {(mode: string | undefined) => Promise<WorkerConfig>} read
 * @param {any} ids identifiers/ids.json
 * @returns {Promise<string[]>} problems, empty when each mode has its own entry
 */
export async function checkModes(read, ids) {
  /** @type {string[]} */
  const problems = [];
  for (const mode of OTHER_MODES) {
    for (const problem of checkProduction(await read(mode), ids)) {
      problems.push(`mode ${JSON.stringify(mode ?? "none")}: ${problem}`);
    }
  }
  for (const [mode, entry] of DEV_ENTRIES) {
    const config = await read(mode);
    if (config.main !== entry) {
      const actual = JSON.stringify(config.main);
      problems.push(`mode ${JSON.stringify(mode)}: entrypoint is ${actual}, expected "${entry}"`);
    }
  }
  return problems;
}

/**
 * The staging Worker (decision 0118) has its own storage in the EU, on
 * Samtak's account, in production's region, and no way to production.
 *
 * @param {WorkerConfig} config the config in staging mode
 * @param {WorkerConfig} production the config as production deploys it
 * @param {any} ids identifiers/ids.json
 * @returns {string[]} problems, empty when the staging config is right
 */
export function checkStaging(config, production, ids) {
  return [
    ...stagingStorage(config, production, ids.cloudflare),
    ...stagingApartFromProduction(config, production, ids.cloudflare),
    ...stagingSecretsAndFakes(config),
  ];
}

/** A check that names the staging thing it holds. */
function stagingExpect(/** @type {string[]} */ problems) {
  return (
    /** @type {unknown} */ actual,
    /** @type {unknown} */ wanted,
    /** @type {string} */ what,
  ) => {
    if (actual !== wanted) {
      problems.push(
        `staging ${what} is ${JSON.stringify(actual)}, expected ${JSON.stringify(wanted)}`,
      );
    }
  };
}

const sortedNames = (/** @type {unknown[]} */ list) => list.map(String).sort().join(",");

/**
 * Every stateful resource, each in the EU. A Durable Object has no jurisdiction
 * of its own: dev/staging.ts runs the real classes, whose stubs src/env/ pins,
 * and never dev/worker.ts's unpinned ones.
 *
 * @param {WorkerConfig} config
 * @param {WorkerConfig} production
 * @param {any} cloudflare
 */
function stagingStorage(config, production, cloudflare) {
  const { staging } = cloudflare;
  /** @type {string[]} */
  const problems = [];
  const expect = stagingExpect(problems);
  expect(config.d1.length === 1 ? config.d1[0]?.name : undefined, staging.d1, "D1 database name");
  expect(
    sortedNames(config.r2.map((b) => b.bucket)),
    sortedNames(Object.values(staging.r2)),
    "R2 buckets are",
  );
  for (const bucket of config.r2) {
    expect(bucket.jurisdiction, cloudflare.jurisdiction, `R2 ${bucket.binding} jurisdiction`);
  }
  const classes = sortedNames(Object.values(cloudflare.durableObjects));
  expect(sortedNames(config.durableObjects.map((b) => b.className)), classes, "DO classes");
  const live = config.classes.filter((c) => c.state === "created");
  expect(sortedNames(live.map((c) => c.className)), classes, "DO classes declared in exports");
  for (const c of live) expect(c.storage, "sqlite", `DO ${c.className} storage`);
  if (config.queues) problems.push("Queues have no jurisdiction and are ruled out (decision 0001)");

  const region = /** @type {any} */ (config.placement)?.region;
  const wanted = /** @type {any} */ (production.placement)?.region;
  if (!EU_REGIONS.has(region) || region !== wanted) {
    problems.push(
      `staging placement is ${JSON.stringify(region)}, expected production's ${JSON.stringify(wanted)}`,
    );
  }
  return problems;
}

/**
 * Where it runs, and nothing of production's: its names, its database by id,
 * its counters.
 *
 * @param {WorkerConfig} config
 * @param {WorkerConfig} production
 * @param {any} cloudflare
 */
function stagingApartFromProduction(config, production, cloudflare) {
  /** @type {string[]} */
  const problems = [];
  const expect = stagingExpect(problems);
  expect(config.accountId, SAMTAK_ACCOUNT, "account id");
  expect(config.main, DEV_ENTRIES.get("staging"), "entrypoint");
  expect(config.workersDev, true, "workersDev");
  if (config.routes.length > 0) {
    problems.push(`staging has routes: ${JSON.stringify(config.routes)}`);
  }
  const theirs = new Set([cloudflare.worker, cloudflare.d1, ...Object.values(cloudflare.r2)]);
  for (const name of new Set(boundNames(config))) {
    if (theirs.has(name)) problems.push(`staging binds the production name ${name}`);
  }
  const productionDb = production.d1[0]?.id;
  if (config.d1.some((d) => d.id === productionDb)) {
    problems.push("staging binds the production D1 id");
  }
  const counters = new Set(production.rateLimits.map((l) => l.namespaceId));
  for (const limit of config.rateLimits) {
    if (counters.has(limit.namespaceId)) {
      problems.push(`staging ${limit.binding} shares a production rate limit namespace`);
    }
  }
  return problems;
}

/**
 * Its secrets are its own and few, since anything more could reach a real
 * provider; its sign-in is the fake; and static files are served ahead of a
 * Worker unless told otherwise, which would answer ahead of the gate.
 *
 * @param {WorkerConfig} config
 */
function stagingSecretsAndFakes(config) {
  /** @type {string[]} */
  const problems = [];
  const expect = stagingExpect(problems);
  expect(sortedNames(config.secrets), sortedNames(STAGING_SECRETS), "declares the secrets");
  expect(config.vars.APNS_TEAM_ID, "", "APNS_TEAM_ID");
  expect(config.vars.APNS_TOPIC, "", "APNS_TOPIC");
  expect(config.vars.ANDROID_CERT_SHA256, "", "ANDROID_CERT_SHA256");
  for (const [name, path] of [
    ["KENNI_ISSUER", "/dev/kenni"],
    ["GOOGLE_ISSUER", "/dev/google"],
  ]) {
    const value = String(config.vars[String(name)]);
    if (!value.endsWith(String(path))) {
      problems.push(`staging ${name} is ${JSON.stringify(value)}, not a fake issuer`);
    }
  }
  expect(config.vars.GOOGLE_CLIENT_ID, "fake-google-client", "GOOGLE_CLIENT_ID");
  expect(config.runWorkerFirst, true, "assets.runWorkerFirst");
  return problems;
}

/**
 * What a staging deploy needs so it creates nothing by itself.
 *
 * @param {WorkerConfig} config the config in staging mode
 * @returns {string[]} problems, empty when it can be deployed
 */
export function checkStagingDeployable(config) {
  const id = config.d1[0]?.id;
  return typeof id === "string" && /^[0-9a-f-]{36}$/.test(id)
    ? []
    : [`D1 ${config.d1[0]?.name} has no id; create it with --jurisdiction eu first`];
}

/** The Worker's production code, every file under backend/src. */
function productionSource() {
  const root = join(ROOT, "backend/src");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((path) => /\.tsx?$/.test(path))
    .map((path) => ({ path: `backend/src/${path}`, text: readFileSync(join(root, path), "utf8") }));
}

/**
 * Production's entry gains no path to the gate or the fakes: no file under
 * backend/src imports from dev/ or names the gate's secret. A comment may say
 * where a dev file is.
 *
 * @param {{ path: string, text: string }[]} [files]
 * @returns {string[]} problems, empty when none does
 */
export function checkProductionSource(files = productionSource()) {
  const importsDev = /(?:\bfrom\s*|\bimport\s*\(?\s*)["'`][^"'`]*\bdev\//;
  return files
    .filter(({ text }) => importsDev.test(text) || text.includes("STAGING_GATE"))
    .map(({ path }) => `${path} reaches a dev file or the staging gate`);
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

  // The buckets the Worker binds.
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
  const stagingConfig = await readWorkerConfig(undefined, "staging");
  const staged = process.argv.includes("--staging");
  const problems = [
    ...checkConfig(config, cloudflare),
    ...checkApns(config, ids),
    ...checkStaging(stagingConfig, config, ids),
    ...(await checkModes((mode) => readWorkerConfig(undefined, mode), ids)),
    ...checkProductionSource(),
  ];
  if (process.argv.includes("--deploy")) problems.push(...checkDeployable(config, ids));
  if (staged) problems.push(...checkStagingDeployable(stagingConfig));

  if (process.argv.includes("--live") && problems.length === 0) {
    const token = process.env.CLOUDFLARE_JURISDICTION_TOKEN;
    if (!token) {
      console.error("❌ --live needs CLOUDFLARE_JURISDICTION_TOKEN (read-only: D1 Read, R2 Read)");
      process.exit(1);
    }
    const live = await checkLive({
      accountId: String(config.accountId),
      token,
      config: staged ? stagingConfig : config,
      cloudflare: staged
        ? { d1: cloudflare.staging.d1, jurisdiction: cloudflare.jurisdiction }
        : cloudflare,
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
