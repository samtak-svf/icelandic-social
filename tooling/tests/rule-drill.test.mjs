// @ts-check
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDrills, commandsFor } from "../rule-drill.mjs";
import { copyRepo, editJson, initRepo } from "./helpers.mjs";

describe("rule-drill", () => {
  it("passes on the repo as it is", () => {
    expect(checkDrills()).toEqual([]);
  });

  it("runs a rule's tests once per package and crate", () => {
    const rule = {
      id: "x",
      domain: "crypto",
      decision: "0002",
      rule: "A rule held in three places.",
      tests: [
        { file: "backend/test/a.test.ts", name: "one" },
        { file: "backend/test/a.test.ts", name: "two" },
        { file: "tooling/tests/b.test.mjs", name: "three" },
        { file: "core/store/src/lib.rs", name: "four" },
      ],
    };
    expect(commandsFor(rule).map((c) => [c.cwd, c.cmd, ...c.args].join(" "))).toEqual([
      "backend pnpm exec vitest run test/a.test.ts",
      ". pnpm exec vitest run tooling/tests/b.test.mjs",
      "core cargo test -q -p spjall-store",
    ]);
  });

  it("fails on a patch that no longer applies, and on one that names no rule", () => {
    const root = copyRepo([
      "tooling/drills",
      "tooling/critical-rules.json",
      "backend/src",
      "tooling/pii-guard.mjs",
    ]);
    initRepo(root);
    writeFileSync(join(root, "backend/src/log.ts"), "// rewritten\n");
    expect(checkDrills(root).join()).toContain("log-redaction.patch no longer applies");
    editJson(root, "tooling/critical-rules.json", (registry) => {
      registry.rules = registry.rules.filter(
        (/** @type {{ id: string }} */ r) => r.id !== "client-floor",
      );
    });
    expect(checkDrills(root).join()).toContain('no rule "client-floor"');
  });
});
