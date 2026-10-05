// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkConfig, checkLive } from "../jurisdiction-check.mjs";
import { readJson, ROOT } from "../lib/repo.mjs";
import { parseJsonc } from "../lib/source.mjs";

const { cloudflare } = readJson("identifiers/ids.json");
const config = () => parseJsonc(readFileSync(join(ROOT, "backend/wrangler.jsonc"), "utf8"));

/**
 * A fake Cloudflare API: `d1` is the jurisdiction the database reports
 * (undefined when it has none, null when it does not exist), `r2` the buckets
 * that exist in the EU.
 *
 * @param {{ d1: string | null | undefined, r2: string[] }} state
 */
function fakeApi(state) {
  /** @type {string[]} */
  const seen = [];
  /** @type {import("../jurisdiction-check.mjs").Fetch} */
  const fetch = async (url, init) => {
    seen.push(`${url} ${init.headers["cf-r2-jurisdiction"] ?? ""}`.trim());
    const reply = (/** @type {number} */ status, /** @type {any} */ body) => ({
      status,
      json: async () => body,
    });
    if (url.includes("/d1/database?name=")) {
      return reply(200, { result: state.d1 === null ? [] : [{ name: cloudflare.d1, uuid: "u1" }] });
    }
    if (url.endsWith("/d1/database/u1")) return reply(200, { result: { jurisdiction: state.d1 } });
    const bucket = url.split("/r2/buckets/")[1] ?? "";
    const euBucket = state.r2.includes(bucket) && init.headers["cf-r2-jurisdiction"] === "eu";
    return euBucket ? reply(200, { result: { name: bucket, jurisdiction: "eu" } }) : reply(404, {});
  };
  return { fetch, seen };
}

const live = (/** @type {{ d1: string | null | undefined, r2: string[] }} */ state) =>
  checkLive({ accountId: "acct", token: "t", cloudflare, fetch: fakeApi(state).fetch });

describe("jurisdiction-check, config", () => {
  it("passes on backend/wrangler.jsonc as it is", () => {
    expect(checkConfig(config(), cloudflare)).toEqual([]);
  });

  it("fails on an R2 binding without the EU jurisdiction", () => {
    const c = config();
    delete c.r2_buckets[0].jurisdiction;
    expect(checkConfig(c, cloudflare).join()).toMatch(/R2 MEDIA jurisdiction is undefined/);
  });

  it("fails on a renamed D1 database, a stray bucket and a queue", () => {
    const c = config();
    c.d1_databases[0].database_name = "spjall-db-2";
    c.r2_buckets.push({ binding: "X", bucket_name: "other", jurisdiction: "eu" });
    c.queues = { producers: [] };
    expect(checkConfig(c, cloudflare)).toHaveLength(3);
  });

  it("fails on another Cloudflare account", () => {
    const c = config();
    c.account_id = "0".repeat(32);
    expect(checkConfig(c, cloudflare).join()).toMatch(/account_id/);
  });
});

describe("jurisdiction-check, live", () => {
  const allBuckets = Object.values(cloudflare.r2).map(String);

  it("passes when D1 and every bucket report eu", async () => {
    const result = await live({ d1: "eu", r2: allBuckets });
    expect(result.problems).toEqual([]);
    expect(result.ok).toHaveLength(1 + allBuckets.length);
  });

  it("fails on a D1 created without --jurisdiction eu", async () => {
    const result = await live({ d1: undefined, r2: allBuckets });
    expect(result.problems).toEqual([`D1 ${cloudflare.d1}: jurisdiction undefined`]);
  });

  it("fails on a missing D1 and a bucket created outside the EU", async () => {
    const result = await live({ d1: null, r2: allBuckets.slice(1) });
    expect(result.problems).toHaveLength(2);
    expect(result.problems[1]).toMatch(/not found in jurisdiction "eu" \(status 404\)/);
  });

  it("asks for R2 buckets with the jurisdiction header", async () => {
    const api = fakeApi({ d1: "eu", r2: allBuckets });
    await checkLive({ accountId: "acct", token: "t", cloudflare, fetch: api.fetch });
    expect(api.seen.filter((s) => s.includes("/r2/")).every((s) => s.endsWith(" eu"))).toBe(true);
  });
});
