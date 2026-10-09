// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bindingNames, findInSource, findViolations } from "../seam-guard.mjs";
import { normalise } from "../lib/worker-config.mjs";
import { copyRepo, initRepo } from "./helpers.mjs";

const BINDINGS = ["CONVERSATION", "DB", "KENNI_CLIENT_SECRET"];
const rules = (/** @type {string} */ file, /** @type {string} */ source) =>
  findInSource(file, source, BINDINGS).map((v) => `${v.rule}:${v.line}`);

describe("seam-guard", () => {
  it("passes on the repo as it is", () => {
    expect(findViolations().violations).toEqual([]);
  });

  it("collects bindings, rate limits, vars and secret names", () => {
    const config = normalise({
      d1_databases: [{ binding: "DB" }],
      durable_objects: { bindings: [{ name: "INBOX" }] },
      ratelimits: [{ name: "LIMIT" }],
      vars: { MIN: "1" },
    });
    expect(bindingNames(config, ["KENNI_CLIENT_SECRET"])).toEqual([
      "DB",
      "INBOX",
      "KENNI_CLIENT_SECRET",
      "LIMIT",
      "MIN",
    ]);
  });

  it("fails on a rate limit or a secret read outside the seam, in the real config", () => {
    // Rate limits and secrets are configured outside `vars` and the binding
    // lists: a guard that reads only those misses them.
    const root = copyRepo(["backend/wrangler.jsonc"]);
    mkdirSync(join(root, "backend/src"), { recursive: true });
    writeFileSync(
      join(root, "backend/src/app.ts"),
      "const a = env.PUBLIC_LIMIT;\nconst b = env.KENNITALA_HMAC_KEY;\n",
    );
    initRepo(root);
    expect(findViolations(root).violations.map((v) => `${v.rule}:${v.line}`)).toEqual([
      "binding:1",
      "binding:2",
    ]);
  });

  it("fails on a binding read outside the seam", () => {
    expect(rules("backend/src/app.ts", "const db = c.env.DB;")).toEqual(["binding:1"]);
    expect(rules("backend/src/auth.ts", "\nconst { KENNI_CLIENT_SECRET } = env;")).toEqual([
      "binding:2",
    ]);
  });

  it("allows a binding read inside the seam", () => {
    expect(rules("backend/src/env/index.ts", "return env.DB;")).toEqual([]);
  });

  it("ignores a binding named in a comment or a log line", () => {
    const source = '// reads DB\nlog("db.missing", { code: "DB is not configured" });';
    expect(rules("backend/src/app.ts", source)).toEqual([]);
  });

  it("fails on console outside the log helper", () => {
    expect(rules("backend/src/app.ts", "console.log(request);")).toEqual(["console:1"]);
    expect(rules("backend/src/do/inbox.ts", "\nconsole . error(e);")).toEqual(["console:2"]);
    expect(rules("backend/src/env/index.ts", "globalThis.console.warn(x);")).toEqual(["console:1"]);
  });

  it("allows console in the log helper and in comments or strings", () => {
    expect(rules("backend/src/log.ts", "console.log(JSON.stringify(line));")).toEqual([]);
    expect(rules("backend/src/app.ts", '// console.log here\nconst s = "console.log";')).toEqual(
      [],
    );
  });

  it("fails on a bare idFromName, even inside the seam", () => {
    expect(rules("backend/src/env/index.ts", "ns.idFromName(id);")).toEqual(["do-jurisdiction:1"]);
    expect(rules("backend/src/env/index.ts", "ns.newUniqueId();")).toEqual(["do-jurisdiction:1"]);
    expect(rules("backend/src/env/index.ts", "ns.getByName(id);")).toEqual(["do-jurisdiction:1"]);
  });

  it("fails on a pinned stub made outside the seam", () => {
    const source = 'x.jurisdiction("eu").getByName(id);';
    expect(rules("backend/src/do/inbox.ts", source)).toEqual(["do-stub:1"]);
  });

  it("fails on a jurisdiction other than eu", () => {
    const source = 'env.NS.jurisdiction("us").getByName(id);';
    expect(rules("backend/src/env/index.ts", source)).toEqual([
      "do-jurisdiction:1",
      "do-jurisdiction:1",
    ]);
  });

  it("accepts the one allowed form, across lines", () => {
    const source = 'env.NS\n  .jurisdiction("eu")\n  .getByName(id);';
    expect(rules("backend/src/env/index.ts", source)).toEqual([]);
  });
});
