// @ts-check
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCaught, checkRegistry, declares } from "../critical-rules.mjs";
import { readJson } from "../lib/repo.mjs";
import { copyRepo } from "./helpers.mjs";

/** @param {Record<string, string>} files */
function fixture(files) {
  const root = copyRepo(["tooling/critical-rules.schema.json", "docs/decisions"]);
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  }
  return root;
}

/**
 * @param {Partial<import("../critical-rules.mjs").Rule>} [rule]
 * @returns {import("../critical-rules.mjs").Registry}
 */
function registry(rule = {}) {
  return {
    rules: [
      {
        id: "log-redaction",
        domain: "pii",
        decision: "0008",
        rule: "A log line redacts what could be a kennitala.",
        tests: [{ file: "backend/test/log.test.ts", name: "redacts a run of digits" }],
        ...rule,
      },
    ],
    retired: [],
  };
}

const LOG_TEST = 'describe("log", () => {\n  it("redacts a run of digits", () => {});\n});\n';

describe("critical-rules", () => {
  it("passes on the repo as it is", () => {
    expect(checkRegistry(readJson("tooling/critical-rules.json"))).toEqual([]);
  });

  it("finds a test by the way each language names it", () => {
    /** @type {[string, string, string][]} */
    const cases = [
      ["a.test.ts", 'it("holds the rule", async () => {})', "holds the rule"],
      ["a.test.mjs", "test('holds the rule', () => {})", "holds the rule"],
      ["a.rs", "#[test]\nfn holds_the_rule() {}", "holds_the_rule"],
      ["A.kt", "@Test\nfun holdsTheRule() {}", "holdsTheRule"],
      ["A.kt", "@Test\nfun `holds the rule`() {}", "holds the rule"],
      ["A.swift", "func testHoldsTheRule() {}", "testHoldsTheRule"],
    ];
    for (const [file, source, name] of cases) expect(declares(file, source, name)).toBe(true);
    expect(declares("a.test.ts", '// "holds the rule"', "holds the rule")).toBe(false);
    expect(declares("a.rs", "fn holds_the_rule_too() {}", "holds_the_rule")).toBe(false);
  });

  it("passes when every named test exists", () => {
    const root = fixture({ "backend/test/log.test.ts": LOG_TEST });
    expect(checkRegistry(registry(), root)).toEqual([]);
  });

  it("fails on a renamed test and on a missing file", () => {
    const renamed = fixture({
      "backend/test/log.test.ts": LOG_TEST.replace("a run of digits", "digits"),
    });
    expect(checkRegistry(registry(), renamed).join()).toContain("renamed or removed");
    expect(checkRegistry(registry(), fixture({})).join()).toContain("does not exist");
  });

  it("fails on a rule no test holds, unless a gap issue says so", () => {
    const root = fixture({});
    expect(checkRegistry(registry({ tests: [] }), root).join()).toContain("no test holds it");
    expect(checkRegistry(registry({ tests: [], gap: "#12" }), root)).toEqual([]);
  });

  it("fails on an unknown decision, a repeated id and a bad shape", () => {
    const root = fixture({ "backend/test/log.test.ts": LOG_TEST });
    expect(checkRegistry(registry({ decision: "9999" }), root).join()).toContain("no record");
    const twice = registry();
    twice.rules.push(...registry().rules);
    expect(checkRegistry(twice, root).join()).toContain("used twice");
    expect(checkRegistry(registry({ domain: "ui" }), root).join()).toContain("/rules/0/domain");
  });

  it("keeps a test that caught a bug, unless it is retired with a reason", () => {
    const caught = { file: "backend/test/log.test.ts", name: "redacts a run of digits" };
    const before = registry({ tests: [{ ...caught, caught: "#41" }] });
    expect(checkCaught(before, registry({ tests: [], gap: "#50" })).join()).toContain("#41");
    expect(checkCaught(before, before)).toEqual([]);
    const retired = registry({ tests: [], gap: "#50" });
    retired.retired = [{ ...caught, reason: "the rule moved into the type system" }];
    expect(checkCaught(before, retired)).toEqual([]);
  });
});
