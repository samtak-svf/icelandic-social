// @ts-check
import { describe, expect, it } from "vitest";
import { bindingNames, findInSource, findViolations } from "../seam-guard.mjs";

const BINDINGS = ["CONVERSATION", "DB", "KENNI_CLIENT_SECRET"];
const rules = (/** @type {string} */ file, /** @type {string} */ source) =>
  findInSource(file, source, BINDINGS).map((v) => `${v.rule}:${v.line}`);

describe("seam-guard", () => {
  it("passes on the repo as it is", () => {
    expect(findViolations().violations).toEqual([]);
  });

  it("collects bindings, vars and secret names", () => {
    const config = {
      d1_databases: [{ binding: "DB" }],
      durable_objects: { bindings: [{ name: "INBOX" }] },
      vars: { MIN: "1" },
    };
    expect(bindingNames(config, "# fake values\nKENNI_CLIENT_SECRET=x\n")).toEqual([
      "DB",
      "INBOX",
      "KENNI_CLIENT_SECRET",
      "MIN",
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
    const source = '// reads DB\nconsole.log("DB is not configured");';
    expect(rules("backend/src/app.ts", source)).toEqual([]);
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
