// @ts-check
import { describe, expect, it } from "vitest";
import {
  checkApns,
  checkConfig,
  checkDeployable,
  checkLive,
  checkModes,
  checkProduction,
  checkProductionSource,
  checkStaging,
  checkStagingDeployable,
} from "../jurisdiction-check.mjs";
import { readJson } from "../lib/repo.mjs";
import { readWorkerConfig } from "../lib/worker-config.mjs";

const ids = readJson("identifiers/ids.json");
const { cloudflare } = ids;
const real = await readWorkerConfig();
const config = () => structuredClone(real);
const realStaging = await readWorkerConfig(undefined, "staging");

const DB_ID = "0b6c1f3e-5d2a-4c8e-9f10-2a3b4c5d6e7f";

/** The Worker config with a known database id, so the fake API can answer for it. */
const deployed = () => {
  const c = config();
  /** @type {any} */ (c.d1[0]).id = DB_ID;
  return c;
};

/** The config as it was before D1 existed: the same file without its database id. */
const undeployed = () => {
  const c = config();
  /** @type {any} */ (c.d1[0]).id = undefined;
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
  it("passes on the Worker config as it is", () => {
    expect(checkConfig(config(), cloudflare)).toEqual([]);
  });

  it("fails on an R2 binding without the EU jurisdiction", () => {
    const c = config();
    /** @type {any} */ (c.r2[0]).jurisdiction = undefined;
    expect(checkConfig(c, cloudflare).join()).toMatch(/R2 MEDIA jurisdiction is undefined/);
  });

  it("fails on a renamed D1 database, a stray bucket and a queue", () => {
    const c = config();
    /** @type {any} */ (c.d1[0]).name = "spjall-db-2";
    c.r2.push({ binding: "X", bucket: "other", jurisdiction: "eu" });
    c.queues = true;
    expect(checkConfig(c, cloudflare)).toHaveLength(3);
  });

  it("fails on Smart Placement, no placement, or a region outside the EU", () => {
    for (const placement of [
      { mode: "smart" },
      undefined,
      { region: "aws:us-east-1" },
      { region: "aws:eu-west-2" },
      { region: "aws:eu-central-2" },
    ]) {
      const c = config();
      c.placement = placement;
      expect(checkConfig(c, cloudflare).join()).toMatch(
        /placement is .*expected \{ region \} in the EU/,
      );
    }
  });

  it("fails on another Cloudflare account", () => {
    const c = config();
    c.accountId = "0".repeat(32);
    expect(checkConfig(c, cloudflare).join()).toMatch(/account id/);
  });

  it("refuses a Durable Object class missing from exports, kv storage, or another Worker's", () => {
    const c = config();
    c.classes = c.classes.filter((k) => k.className !== "Inbox");
    expect(checkConfig(c, cloudflare).join()).toMatch(/DO classes declared in exports/);
    const d = config();
    /** @type {any} */ (d.classes[0]).storage = "legacy-kv";
    expect(checkConfig(d, cloudflare).join()).toMatch(/storage is "legacy-kv"/);
    const e = config();
    /** @type {any} */ (e.durableObjects[0]).worker = "other-worker";
    expect(checkConfig(e, cloudflare).join()).toMatch(/Worker is "other-worker"/);
  });

  it("passes the APNs vars of the interim team, and refuses any other pair", () => {
    expect(checkApns(config(), ids)).toEqual([]);
    const c = config();
    c.vars.APNS_TOPIC = ids.store.iosBundleId;
    expect(checkApns(c, ids).join()).toMatch(/APNS_TOPIC/);
    const d = config();
    d.vars.APNS_TEAM_ID = "ZZZZZZZZZZ";
    expect(checkApns(d, ids).join()).toMatch(/APNS_TEAM_ID/);
  });

  it("passes Samtak's own team once ids.json names it, with its bundle id", () => {
    const own = { ...ids, services: { ...ids.services, appleTeamId: "SAMTAK0001" } };
    const c = config();
    c.vars.APNS_TEAM_ID = "SAMTAK0001";
    c.vars.APNS_TOPIC = ids.store.iosBundleId;
    c.vars.APPLE_TEAM_ID = "SAMTAK0001";
    expect(checkApns(c, own)).toEqual([]);
    c.vars.APPLE_TEAM_ID = ids.appleInterim.teamId;
    expect(checkApns(c, own).join()).toMatch(/APPLE_TEAM_ID/);
  });

  it("refuses a signing fingerprint Android would not match", () => {
    const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");
    const c = config();
    c.vars.ANDROID_CERT_SHA256 = fingerprint;
    expect(checkApns(c, ids)).toEqual([]);
    for (const wrong of [fingerprint.toLowerCase(), fingerprint.replaceAll(":", ""), "AB:CD"]) {
      c.vars.ANDROID_CERT_SHA256 = wrong;
      expect(checkApns(c, ids).join()).toMatch(/ANDROID_CERT_SHA256/);
    }
  });
});

describe("jurisdiction-check, live", () => {
  const bound = deployed().r2.map((b) => String(b.bucket));

  it("passes when the bound D1 and every bound bucket report eu", async () => {
    const result = await live({ d1: "eu", r2: bound });
    expect(result.problems).toEqual([]);
    expect(result.ok).toHaveLength(1 + bound.length);
  });

  it("asks only for the buckets the Worker binds, and every frozen bucket is bound", async () => {
    // Decision 0102 retired the one frozen bucket nothing bound.
    expect([...Object.values(cloudflare.r2)].sort()).toEqual([...bound].sort());
    const api = fakeApi({ d1: "eu", r2: bound });
    const result = await checkLive({
      accountId: "acct",
      token: "t",
      config: deployed(),
      cloudflare,
      fetch: api.fetch,
    });
    expect(result.problems).toEqual([]);
    expect(api.seen.filter((s) => s.includes("/r2/buckets/"))).toHaveLength(bound.length);
  });

  it("fails on a D1 created without --jurisdiction eu", async () => {
    const result = await live({ d1: undefined, r2: bound });
    expect(result.problems).toEqual([`D1 ${cloudflare.d1}: jurisdiction undefined`]);
  });

  it("fails when the bound id names another database", async () => {
    const result = await live({ d1: "eu", name: "spjall-db-old", r2: bound });
    expect(result.problems.join()).toMatch(/is named "spjall-db-old"/);
  });

  it("fails without a database id, and on a missing D1 and a bucket outside the EU", async () => {
    expect((await live({ d1: "eu", r2: bound }, undeployed())).problems).toEqual([
      `D1 ${cloudflare.d1}: backend/cloudflare.config.ts has no database id`,
    ]);
    const result = await live({ d1: null, r2: [] });
    expect(result.problems).toHaveLength(1 + bound.length);
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

  it("passes on the Worker config as it is", () => {
    expect(checkDeployable(config(), ids)).toEqual([]);
  });

  it("refuses a config whose D1 has no id", () => {
    expect(checkDeployable(undeployed(), ids).join()).toMatch(/has no id/);
  });

  it("refuses the interop entry, which serves a fake Kenni", async () => {
    const c = deployed();
    c.main = "dev/worker.ts";
    expect(checkDeployable(c, ids).join()).toMatch(/entrypoint is "dev\/worker.ts"/);
    expect((await readWorkerConfig(undefined, "interop")).main).toBe("dev/worker.ts");
  });

  it("refuses a route off the frozen API host, a zone route and workers.dev", () => {
    const c = deployed();
    c.routes = [{ pattern: "api.example.org", customDomain: true }];
    expect(checkDeployable(c, ids).join()).toMatch(/routes is/);
    c.routes = [{ pattern: ids.hosts.api, customDomain: false }];
    expect(checkDeployable(c, ids).join()).toMatch(/routes is/);
    const d = deployed();
    d.workersDev = undefined;
    expect(checkDeployable(d, ids)).toEqual(["workersDev must be false"]);
  });
});

describe("jurisdiction-check, staging", () => {
  const staging = () => structuredClone(realStaging);
  const problems = (/** @type {import("../lib/worker-config.mjs").WorkerConfig} */ c) =>
    checkStaging(c, real, ids).join("\n");

  it("passes on the staging config as it is", () => {
    expect(checkStaging(staging(), real, ids)).toEqual([]);
    expect(realStaging.main).toBe("dev/staging.ts");
    expect(realStaging.workersDev).toBe(true);
    expect(realStaging.routes).toEqual([]);
  });

  it("fails when an R2 bucket loses its jurisdiction or is removed", () => {
    const c = staging();
    /** @type {any} */ (c.r2[0]).jurisdiction = undefined;
    expect(problems(c)).toMatch(/staging R2 MEDIA jurisdiction is undefined/);
    const d = staging();
    d.r2 = d.r2.filter((b) => b.binding !== "PROFILES");
    expect(problems(d)).toMatch(/staging R2 buckets are/);
  });

  it("fails when D1 is removed or a Durable Object class is dropped", () => {
    const c = staging();
    c.d1 = [];
    expect(problems(c)).toMatch(/staging D1 database name/);
    const d = staging();
    d.classes = d.classes.filter((k) => k.className !== "Space");
    expect(problems(d)).toMatch(/staging DO classes declared in exports/);
    const e = staging();
    e.durableObjects = e.durableObjects.filter((b) => b.binding !== "INBOX");
    expect(problems(e)).toMatch(/staging DO classes/);
  });

  it("fails on a queue, a placement outside the EU, or another placement than production's", () => {
    const c = staging();
    c.queues = true;
    expect(problems(c)).toMatch(/Queues have no jurisdiction/);
    for (const region of ["aws:eu-west-2", "aws:eu-central-1"]) {
      const d = staging();
      d.placement = { region };
      expect(problems(d)).toMatch(/staging placement/);
    }
  });

  it("fails on another account, a custom domain, workers.dev off, or the production entry", () => {
    const c = staging();
    c.accountId = "0".repeat(32);
    expect(problems(c)).toMatch(/staging account id/);
    const d = staging();
    d.routes = [{ pattern: ids.hosts.api, customDomain: true }];
    expect(problems(d)).toMatch(/staging has routes/);
    const e = staging();
    e.workersDev = false;
    expect(problems(e)).toMatch(/staging workersDev/);
    const f = staging();
    f.main = "src/index.ts";
    expect(problems(f)).toMatch(/staging entrypoint/);
    const g = staging();
    g.main = "dev/worker.ts";
    expect(problems(g)).toMatch(/staging entrypoint/);
  });

  it("fails when it binds a production resource by name or by id", () => {
    const worker = staging();
    worker.name = cloudflare.worker;
    expect(problems(worker)).toMatch(/production name spjall-api/);
    const db = staging();
    /** @type {any} */ (db.d1[0]).name = cloudflare.d1;
    expect(problems(db)).toMatch(/production name spjall-db/);
    const byId = staging();
    /** @type {any} */ (byId.d1[0]).id = real.d1[0]?.id;
    expect(problems(byId)).toMatch(/production D1 id/);
    const bucket = staging();
    /** @type {any} */ (bucket.r2[0]).bucket = cloudflare.r2.media;
    expect(problems(bucket)).toMatch(/production name spjall-media/);
    const object = staging();
    /** @type {any} */ (object.durableObjects[0]).worker = cloudflare.worker;
    expect(problems(object)).toMatch(/production name spjall-api/);
    const limit = staging();
    /** @type {any} */ (limit.rateLimits[0]).namespaceId = real.rateLimits[0]?.namespaceId;
    expect(problems(limit)).toMatch(/production rate limit namespace/);
  });

  it("fails on a secret or a var that opens a way to production", () => {
    const secret = staging();
    secret.secrets.push("FCM_SERVICE_ACCOUNT");
    expect(problems(secret)).toMatch(/staging declares the secrets/);
    const team = staging();
    team.vars.APNS_TEAM_ID = "B4724Z74TM";
    expect(problems(team)).toMatch(/staging APNS_TEAM_ID/);
    const topic = staging();
    topic.vars.APNS_TOPIC = ids.appleInterim.iosBundleId;
    expect(problems(topic)).toMatch(/staging APNS_TOPIC/);
    for (const [name, value] of [
      ["KENNI_ISSUER", "https://idp.kenni.is/innskraning.is"],
      ["GOOGLE_ISSUER", "https://accounts.google.com"],
      ["GOOGLE_CLIENT_ID", "654764079866-example.apps.googleusercontent.com"],
    ]) {
      const c = staging();
      c.vars[String(name)] = value;
      expect(problems(c)).toMatch(new RegExp(`staging ${name}`));
    }
  });

  it("fails when the gate is not declared or static files skip the Worker", () => {
    const secret = staging();
    secret.secrets = secret.secrets.filter((s) => s !== "STAGING_GATE");
    expect(problems(secret)).toMatch(/staging declares the secrets/);
    const assets = staging();
    assets.runWorkerFirst = undefined;
    expect(problems(assets)).toMatch(/runWorkerFirst/);
  });

  it("holds a staging deploy to a D1 id, and checks staging's own storage live", async () => {
    const c = staging();
    /** @type {any} */ (c.d1[0]).id = undefined;
    expect(checkStagingDeployable(c).join()).toMatch(/has no id/);
    /** @type {any} */ (c.d1[0]).id = DB_ID;
    expect(checkStagingDeployable(c)).toEqual([]);
    const buckets = c.r2.map((b) => String(b.bucket));
    const result = await checkLive({
      accountId: "acct",
      token: "t",
      config: c,
      cloudflare: { d1: cloudflare.staging.d1, jurisdiction: cloudflare.jurisdiction },
      fetch: fakeApi({ d1: "eu", name: cloudflare.staging.d1, r2: buckets }).fetch,
    });
    expect(result.problems).toEqual([]);
  });
});

describe("jurisdiction-check, what reaches production", () => {
  const modes =
    (/** @type {Record<string, any>} */ bent = {}) =>
    /** @param {string | undefined} mode */
    async (mode) =>
      bent[String(mode)] ?? readWorkerConfig(undefined, mode);

  it("passes on every mode as it is", async () => {
    expect(await checkModes(modes(), ids)).toEqual([]);
  });

  it("fails when production's entry, workers.dev or name moves", () => {
    const entry = config();
    entry.main = "dev/staging.ts";
    expect(checkProduction(entry, ids).join()).toMatch(/entrypoint is "dev\/staging.ts"/);
    const open = config();
    open.workersDev = true;
    expect(checkProduction(open, ids).join()).toMatch(/workersDev must be false/);
    const name = config();
    name.name = cloudflare.staging.worker;
    expect(checkProduction(name, ids).join()).toMatch(/staging name spjall-api-staging/);
  });

  it("fails when production binds a staging resource or declares the gate", () => {
    const bucket = config();
    /** @type {any} */ (bucket.r2[0]).bucket = cloudflare.staging.r2.media;
    expect(checkProduction(bucket, ids).join()).toMatch(/staging name spjall-media-staging/);
    const gate = config();
    gate.secrets.push("STAGING_GATE");
    expect(checkProduction(gate, ids).join()).toMatch(/declares STAGING_GATE/);
  });

  it("fails when a fake issuer reaches production", () => {
    for (const name of ["KENNI_ISSUER", "GOOGLE_ISSUER"]) {
      const c = config();
      c.vars[name] = "https://staging.invalid/dev/fake";
      expect(checkProduction(c, ids).join()).toMatch(new RegExp(`${name} is a fake issuer`));
    }
    const client = config();
    client.vars.GOOGLE_CLIENT_ID = "fake-google-client";
    expect(checkProduction(client, ids).join()).toMatch(/GOOGLE_CLIENT_ID is a fake client/);
  });

  it("fails when a dev entry reaches any mode but interop and staging", async () => {
    const leaked = config();
    leaked.main = "dev/worker.ts";
    const problems = await checkModes(modes({ production: leaked }), ids);
    expect(problems.join()).toMatch(/mode "production": entrypoint is "dev\/worker.ts"/);
    const moved = config();
    moved.main = "dev/staging.ts";
    expect((await checkModes(modes({ interop: moved }), ids)).join()).toMatch(
      /mode "interop": entrypoint is "dev\/staging.ts", expected "dev\/worker.ts"/,
    );
  });

  it("fails when production's code imports a dev file or names the gate", () => {
    expect(
      checkProductionSource([{ path: "src/a.ts", text: "// dev/worker.ts is not here" }]),
    ).toEqual([]);
    for (const text of [
      'import { gated } from "../dev/staging-app.ts";',
      'const m = await import("../../dev/oidc.ts");',
      "env.STAGING_GATE",
    ]) {
      expect(checkProductionSource([{ path: "src/a.ts", text }]).join()).toMatch(/src\/a.ts/);
    }
  });

  it("passes on production's code as it is", () => {
    expect(checkProductionSource()).toEqual([]);
  });
});
