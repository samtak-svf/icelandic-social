// @ts-check
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";
import { amendersOfScope, parseRecord, readRecords, render } from "../gen-decisions-index.mjs";
import { copyRepo } from "./helpers.mjs";

const rec = (/** @type {string} */ n, /** @type {string} */ status, date = "2026-10-01") =>
  parseRecord(`${n}-x.md`, `# ${n}. Title ${n} | pipe\n\n- Status: ${status}\n- Date: ${date}\n`);

describe("parseRecord", () => {
  it("reads title, first status clause and date", () => {
    const r = rec("0033", "accepted; implemented in the core");
    expect(r).toMatchObject({ title: "Title 0033 | pipe", status: "accepted", date: "2026-10-01" });
  });

  it("refuses a record without a date", () => {
    expect(() => parseRecord("0001-x.md", "# 0001. T\n\n- Status: accepted\n")).toThrow(
      /Status and Date/,
    );
  });
});

describe("render", () => {
  const records = [
    rec("0009", "accepted; amended by 0040 and 0033", "2026-10-05"),
    rec("0033", "accepted", "2026-10-09"),
    rec("0040", "accepted", "2026-10-08"),
    rec("0041", "accepted"),
  ];

  it("lists the amenders of 0009 by date, and only them", () => {
    expect(amendersOfScope(records)).toEqual(["0040", "0033"]);
    const scope = render(records).split("## All records")[0] ?? "";
    expect(scope.indexOf("0040")).toBeLessThan(scope.indexOf("0033"));
    expect(scope).not.toContain("0041");
    expect(scope).toContain("The 2 records below");
  });

  it("escapes a pipe in a title and lists every record", () => {
    const text = render(records);
    expect(text).toContain("Title 0041 \\| pipe");
    expect((text.split("## All records")[1] ?? "").match(/\[00\d\d\]/g)).toHaveLength(4);
  });
});

describe("docs/decisions/README.md", () => {
  it("is current and covers every record and every amender in 0009's status", () => {
    const records = readRecords();
    const text = readFileSync(join(ROOT, "docs/decisions/README.md"), "utf8");
    expect(text).toBe(render(records));
    expect(amendersOfScope(records).length).toBeGreaterThan(20);
    for (const r of records) expect(text).toContain(`[${r.number}](${r.file})`);
  });

  it("--check fails on a stale README and passes after a rewrite", () => {
    const dir = copyRepo([
      "tooling/gen-decisions-index.mjs",
      "tooling/lib/repo.mjs",
      "docs/decisions",
    ]);
    const script = join(dir, "tooling/gen-decisions-index.mjs");
    const run = (/** @type {string[]} */ args) =>
      spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
    expect(run(["--check"]).status).toBe(0);
    writeFileSync(join(dir, "docs/decisions/README.md"), "stale\n");
    expect(run(["--check"]).status).toBe(1);
    expect(run([]).status).toBe(0);
    expect(run(["--check"]).status).toBe(0);
  });
});
