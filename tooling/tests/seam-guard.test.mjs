// @ts-check
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bindingNames, findInSource, findViolations } from "../seam-guard.mjs";
import { normalise } from "../lib/worker-config.mjs";
import { ROOT } from "../lib/repo.mjs";
import { copyRepo, initRepo } from "./helpers.mjs";

const BINDINGS = ["CONVERSATION", "DB", "KENNI_CLIENT_SECRET"];
const rules = (/** @type {string} */ file, /** @type {string} */ source) =>
  findInSource(file, source, BINDINGS).map((v) => `${v.rule}:${v.line}`);

describe("seam-guard", () => {
  it("passes on the repo as it is", async () => {
    expect((await findViolations()).violations).toEqual([]);
  });

  it("collects bindings, rate limits, vars and secret names", () => {
    const config = normalise({
      worker: {
        env: {
          DB: { type: "d1" },
          INBOX: { type: "durable-object" },
          LIMIT: { type: "rate-limit" },
          MIN: { type: "text", value: "1" },
        },
      },
    });
    expect(bindingNames(config, ["KENNI_CLIENT_SECRET"])).toEqual([
      "DB",
      "INBOX",
      "KENNI_CLIENT_SECRET",
      "LIMIT",
      "MIN",
    ]);
  });

  it("fails on a rate limit or a secret read outside the seam, in the real config", async () => {
    // Rate limits and secrets are configured outside `vars` and the binding
    // lists: a guard that reads only those misses them.
    const root = copyRepo(["backend/cloudflare.config.ts", "backend/package.json"]);
    // The config imports cf/config, resolved from backend/node_modules.
    symlinkSync(join(ROOT, "backend/node_modules"), join(root, "backend/node_modules"));
    mkdirSync(join(root, "backend/src"), { recursive: true });
    writeFileSync(
      join(root, "backend/src/app.ts"),
      "const a = env.PUBLIC_LIMIT;\nconst b = env.KENNITALA_HMAC_KEY;\n",
    );
    initRepo(root);
    expect((await findViolations(root)).violations.map((v) => `${v.rule}:${v.line}`)).toEqual([
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

  it("fails on an error body built outside the error helper", () => {
    expect(rules("backend/src/app.ts", 'return c.json({ error: "not_found" }, 404);')).toEqual([
      "error-body:1",
    ]);
    expect(
      rules("backend/src/feed.ts", "\nreturn c.json(\n  { error: code },\n  403,\n);"),
    ).toEqual(["error-body:2"]);
    expect(rules("backend/src/link.ts", 'return Response.json({ error: "x" });')).toEqual([
      "error-body:1",
    ]);
  });

  it("allows an error body in the error helper, and a success body anywhere", () => {
    const helper = "return c.json({ error, ...extra, requestId: c.var.requestId }, status);";
    expect(rules("backend/src/errors.ts", helper)).toEqual([]);
    expect(rules("backend/src/app.ts", "return c.json({ errors: [] }, 200);")).toEqual([]);
    expect(rules("backend/src/app.ts", '// c.json({ error: "x" })\nfail(c, 404, "x");')).toEqual(
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
