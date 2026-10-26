// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkIndex } from "../index-check.mjs";
import { ROOT } from "../lib/repo.mjs";

const agents = ["# T", "", "## One", "a", "b", "## Two", "c", ""].join("\n");
const index = (/** @type {string} */ one, /** @type {string} */ two, lines = 7) =>
  [
    `read the section in AGENTS.md (${lines} lines)`,
    "| Topic | Line Range | Description |",
    "| ----- | ---------- | ----------- |",
    `| **One** | ${one} | first |`,
    `| **Two** | ${two} | second |`,
    "",
  ].join("\n");

describe("index-check", () => {
  it("passes when every range matches", () => {
    expect(checkIndex(agents, index("3-5", "6-7")).problems).toEqual([]);
  });

  it("fails when a heading shifts, and fixes the range in place", () => {
    const shifted = ["# T", "", "", "## One", "a", "b", "## Two", "c", ""].join("\n");
    const result = checkIndex(shifted, index("3-5", "6-7"));
    expect(result.problems).toEqual([
      '"One": INDEX.md says 3-5, AGENTS.md has 4-6',
      '"Two": INDEX.md says 6-7, AGENTS.md has 7-8',
      "header says AGENTS.md has 7 lines, it has 8",
    ]);
    expect(checkIndex(shifted, result.fixed).problems).toEqual([]);
  });

  it("fails on a section without a row and on a row without a heading", () => {
    const more = `${agents}## Three\nd\n`;
    expect(checkIndex(more, index("3-5", "6-7", 9)).problems).toEqual([
      'section "Three" (line 8) has no row in INDEX.md',
    ]);
    expect(checkIndex(agents, index("3-5", "6-7")).problems).toEqual([]);
  });

  it("fails when a heading shifts, and fixes the range in place", () => {
    const shifted = ["# T", "", "", "## One", "a", "b", "## Two", "c", ""].join("\n");
    const result = checkIndex(shifted, index("3-5", "6-7"));
    expect(result.problems).toEqual([
      '"One": INDEX.md says 3-5, AGENTS.md has 4-6',
      '"Two": INDEX.md says 6-7, AGENTS.md has 7-8',
      "header says AGENTS.md has 7 lines, it has 8",
    ]);
    expect(checkIndex(shifted, result.fixed).problems).toEqual([]);
  });

  it("fails on a section without a row and on a row without a heading", () => {
    const more = `${agents}## Three\nd\n`;
    expect(checkIndex(more, index("3-5", "6-7", 9)).problems).toEqual(
      [
        'section "Three" (line 8) has no row in INDEX.md',
        '"Two": INDEX.md says 6-7, AGENTS.md has 6-7',
      ].slice(0, 1),
    );
    expect(checkIndex(agents, index("3-5", "6-7").replace("**Two**", "**Gone**")).problems).toEqual(
      [
        'row "Gone" matches no heading in AGENTS.md',
        'section "Two" (line 6) has no row in INDEX.md',
      ],
    );
  });

  it("ignores a heading inside a code fence", () => {
    const fenced = ["# T", "## One", "```", "## not a section", "```", ""].join("\n");
    const rows = "| **One** | 2-5 | x |\n";
    expect(checkIndex(fenced, rows).problems).toEqual([]);
  });

  it("holds for this repo's AGENTS.md and INDEX.md", () => {
    const real = checkIndex(
      readFileSync(join(ROOT, "AGENTS.md"), "utf8"),
      readFileSync(join(ROOT, "INDEX.md"), "utf8"),
    );
    expect(real.problems).toEqual([]);
  });
});
