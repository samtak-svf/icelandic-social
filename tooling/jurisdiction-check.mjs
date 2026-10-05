// @ts-check
// EU residency of the Worker's storage (decision 0001, plan §4).
//
// A jurisdiction can only be set when a D1 database or R2 bucket is created,
// and wrangler auto-provisions a missing one on deploy WITHOUT it. So two
// checks, because neither can see what the other can:
//
// `node tooling/jurisdiction-check.mjs`         offline, in `pnpm check`:
//     backend/wrangler.jsonc names exactly the frozen ids, every R2 binding
//     says jurisdiction "eu", the account is the personal one, no Queues.
// `node tooling/jurisdiction-check.mjs --live`  CI only, read-only token:
//     asks the Cloudflare REST API whether D1 and both R2 buckets exist IN
//     the EU jurisdiction. Needs CLOUDFLARE_JURISDICTION_TOKEN (D1 Read,
//     Workers R2 Storage Read).
//
// Durable Objects are not checked here: a namespace has no jurisdiction the
// API can report. Each object id is pinned in code instead
// (tooling/seam-guard.mjs).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, ROOT } from "./lib/repo.mjs";
import { parseJsonc } from "./lib/source.mjs";

/** Samtak's personal Cloudflare account (AGENTS.md § Infrastructure). */
export const PERSONAL_ACCOUNT = "af4d4a9c4527ce1e46d0c2dc1165e801";
const API = "https://api.cloudflare.com/client/v4";

/**
 * @param {any} config parsed backend/wrangler.jsonc
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

  expect(config.account_id, PERSONAL_ACCOUNT, "account_id");
  expect(config.name, cloudflare.worker, "Worker name");

  const d1 = config.d1_databases ?? [];
  expect(d1.length, 1, "number of D1 databases");
  expect(d1[0]?.database_name, cloudflare.d1, "D1 database_name");

  const frozenBuckets = new Set(Object.values(cloudflare.r2));
  for (const bucket of config.r2_buckets ?? []) {
    if (!frozenBuckets.has(bucket.bucket_name)) {
      problems.push(`R2 bucket ${bucket.bucket_name} is not a frozen id`);
    }
    expect(bucket.jurisdiction, cloudflare.jurisdiction, `R2 ${bucket.binding} jurisdiction`);
  }

  const classes = (config.durable_objects?.bindings ?? []).map(
    (/** @type {any} */ b) => b.class_name,
  );
  expect(
    classes.sort().join(","),
    Object.values(cloudflare.durableObjects).sort().join(","),
    "DO classes",
  );

  if (config.queues) problems.push("Queues have no jurisdiction and are ruled out (decision 0001)");
  return problems;
}

/**
 * @typedef {(url: string, init: { headers: Record<string, string> }) => Promise<{ status: number, json(): Promise<any> }>} Fetch
 */

/**
 * @param {{ accountId: string, token: string, cloudflare: any, fetch: Fetch }} options
 * @returns {Promise<{ ok: string[], problems: string[] }>}
 */
export async function checkLive({ accountId, token, cloudflare, fetch }) {
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

  const list = await get(`/d1/database?name=${encodeURIComponent(cloudflare.d1)}`);
  const db = (list.body.result ?? []).find((/** @type {any} */ d) => d.name === cloudflare.d1);
  if (!db) {
    problems.push(`D1 ${cloudflare.d1}: not found (status ${list.status})`);
  } else {
    const detail = await get(`/d1/database/${db.uuid}`);
    const actual = detail.body.result?.jurisdiction;
    (actual === want ? ok : problems).push(
      `D1 ${cloudflare.d1}: jurisdiction ${JSON.stringify(actual)}`,
    );
  }

  for (const bucket of Object.values(cloudflare.r2)) {
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
  const config = parseJsonc(readFileSync(join(ROOT, "backend/wrangler.jsonc"), "utf8"));
  const { cloudflare } = readJson("identifiers/ids.json");
  const problems = checkConfig(config, cloudflare);

  if (process.argv.includes("--live") && problems.length === 0) {
    const token = process.env.CLOUDFLARE_JURISDICTION_TOKEN;
    if (!token) {
      console.error("❌ --live needs CLOUDFLARE_JURISDICTION_TOKEN (read-only: D1 Read, R2 Read)");
      process.exit(1);
    }
    const live = await checkLive({
      accountId: config.account_id,
      token,
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
  for (const problem of problems) console.error(`::error file=backend/wrangler.jsonc::${problem}`);
  console.error(`
Every D1 database and R2 bucket is created with --jurisdiction eu, which can
never be added later (AGENTS.md § Infrastructure, docs/decisions/0001).`);
  process.exit(1);
}

if (import.meta.main) await main();
