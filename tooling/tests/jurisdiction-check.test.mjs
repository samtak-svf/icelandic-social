// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkConfig, checkDeployable, checkLive } from "../jurisdiction-check.mjs";
import { readJson, ROOT } from "../lib/repo.mjs";
import { parseJsonc } from "../lib/source.mjs";

const ids = readJson("identifiers/ids.json");
const { cloudflare } = ids;
const config = () => parseJsonc(readFileSync(join(ROOT, "backend/wrangler.jsonc"), "utf8"));

const DB_ID = "0b6c1f3e-5d2a-4c8e-9f10-2a3b4c5d6e7f";

/** wrangler.jsonc as it is once D1 exists: the same file with its database_id. */
const deployed = () => {
  const c = config();
  c.d1_databases[0].database_id = DB_ID;
  return c;
};

/**
 * A fake Cloudflare API: `d1` is the jurisdiction the database DB_ID reports
 * (undefined when it has none, null when it does not exist), `name` its name,
 * `r2` the buckets that exist in the EU.
 *
 * @param {{ d1: string | null | undefined, name?: string, r2: string[] }} state
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
    if (url.endsWith(`/d1/database/${DB_ID}`)) {
      if (state.d1 === null) return reply(404, {});
      return reply(200, { result: { name: state.name ?? cloudflare.d1, jurisdiction: state.d1 } });
    }
    if (url.includes("/d1/")) return reply(404, {});
    const bucket = url.split("/r2/buckets/")[1] ?? "";
    const euBucket = state.r2.includes(bucket) && init.headers["cf-r2-jurisdiction"] === "eu";
    return euBucket ? reply(200, { result: { name: bucket, jurisdiction: "eu" } }) : reply(404, {});
  };
  return { fetch, seen };
}

const live = (
  /** @type {{ d1: string | null | undefined, name?: string, r2: string[] }} */ state,
  c = deployed(),
) =>
  checkLive({ accountId: "acct", token: "t", config: c, cloudflare, fetch: fakeApi(state).fetch });

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
  const bound = deployed().r2_buckets.map((/** @type {any} */ b) => String(b.bucket_name));

  it("passes when the bound D1 and every bound bucket report eu", async () => {
    const result = await live({ d1: "eu", r2: bound });
    expect(result.problems).toEqual([]);
    expect(result.ok).toHaveLength(1 + bound.length);
  });

  it("does not ask for a frozen bucket that nothing binds", async () => {
    // spjall-artifacts is a frozen id that decision 0013 retired; no config
    // binds it, so its absence is not a residency problem.
    expect(Object.values(cloudflare.r2)).toContain("spjall-artifacts");
    const api = fakeApi({ d1: "eu", r2: bound });
    const result = await checkLive({
      accountId: "acct",
      token: "t",
      config: deployed(),
      cloudflare,
      fetch: api.fetch,
    });
    expect(result.problems).toEqual([]);
    expect(api.seen.some((s) => s.includes("spjall-artifacts"))).toBe(false);
  });

  it("fails on a D1 created without --jurisdiction eu", async () => {
    const result = await live({ d1: undefined, r2: bound });
    expect(result.problems).toEqual([`D1 ${cloudflare.d1}: jurisdiction undefined`]);
  });

  it("fails when the bound id names another database", async () => {
    const result = await live({ d1: "eu", name: "spjall-db-old", r2: bound });
    expect(result.problems.join()).toMatch(/is named "spjall-db-old"/);
  });

  it("fails without a database_id, and on a missing D1 and a bucket outside the EU", async () => {
    expect((await live({ d1: "eu", r2: bound }, config())).problems).toEqual([
      `D1 ${cloudflare.d1}: wrangler.jsonc has no database_id`,
    ]);
    const result = await live({ d1: null, r2: [] });
    expect(result.problems).toHaveLength(2);
    expect(result.problems[1]).toMatch(/not found in jurisdiction "eu" \(status 404\)/);
  });

  it("asks for R2 buckets with the jurisdiction header", async () => {
    const api = fakeApi({ d1: "eu", r2: bound });
    await checkLive({
      accountId: "acct",
      token: "t",
      config: deployed(),
      cloudflare,
      fetch: api.fetch,
    });
    expect(api.seen.filter((s) => s.includes("/r2/")).every((s) => s.endsWith(" eu"))).toBe(true);
  });
});

describe("jurisdiction-check, deploy", () => {
  it("passes once D1 has its id", () => {
    expect(checkDeployable(deployed(), ids)).toEqual([]);
  });

  it("refuses wrangler.jsonc as committed before D1 exists", () => {
    expect(checkDeployable(config(), ids).join()).toMatch(/has no database_id/);
  });

  it("refuses a route off the frozen API host, a zone route and workers.dev", () => {
    const c = deployed();
    c.routes = [{ pattern: "api.example.org", custom_domain: true }];
    expect(checkDeployable(c, ids).join()).toMatch(/routes is/);
    c.routes = [{ pattern: `${ids.hosts.api}/*`, zone_name: "samtak.is" }];
    expect(checkDeployable(c, ids).join()).toMatch(/routes is/);
    const d = deployed();
    delete d.workers_dev;
    expect(checkDeployable(d, ids)).toEqual(["workers_dev must be false"]);
  });
});
