// @ts-check
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkArea, readSummary } from "../coverage-floor.mjs";
import { readJson, ROOT } from "../lib/repo.mjs";

const area = /** @type {import("../coverage-floor.mjs").Area} */ ({
  summary: "coverage/backend/coverage-summary.json",
  format: "istanbul",
  modules: { "backend/src/log.ts": { lines: 95, branches: 90 } },
});

/** @param {number} lines @param {number} branches */
const istanbul = (lines, branches) => ({
  total: { lines: { pct: 1 }, branches: { pct: 1 } },
  "/repo/backend/src/log.ts": { lines: { pct: lines }, branches: { pct: branches } },
});

describe("coverage-floor", () => {
  it("lists only modules that exist, for both areas", () => {
    const floors = readJson("tooling/coverage-floor.json");
    for (const name of ["backend", "core"]) {
      const modules = Object.keys(floors[name].modules);
      expect(modules.length).toBeGreaterThan(0);
      for (const m of modules) expect(existsSync(join(ROOT, m)), m).toBe(true);
    }
  });

  it("reads istanbul and llvm-cov summaries by path from the root", () => {
    expect(readSummary("istanbul", istanbul(96, 91), "/repo").get("backend/src/log.ts")).toEqual({
      lines: 96,
      branches: 91,
    });
    const llvm = {
      data: [
        {
          files: [
            {
              filename: "/repo/core/store/src/lib.rs",
              summary: { lines: { percent: 99.4 }, regions: { percent: 97.2 } },
            },
          ],
        },
      ],
    };
    expect(readSummary("llvm-cov", llvm, "/repo").get("core/store/src/lib.rs")).toEqual({
      lines: 99.4,
      branches: 97.2,
    });
  });

  it("passes at the floor and fails below it, naming the module and the kind", () => {
    expect(checkArea("backend", area, readSummary("istanbul", istanbul(95, 90), "/repo"))).toEqual(
      [],
    );
    const below = checkArea("backend", area, readSummary("istanbul", istanbul(95, 89.5), "/repo"));
    expect(below).toHaveLength(1);
    expect(below[0]).toContain("backend/src/log.ts branches 89.50%");
  });

  it("fails closed: a listed module with no data fails, and so does an empty list", () => {
    expect(checkArea("backend", area, new Map()).join()).toContain("has no coverage data");
    expect(checkArea("backend", { ...area, modules: {} }, new Map()).join()).toContain(
      "no modules listed",
    );
  });
});
