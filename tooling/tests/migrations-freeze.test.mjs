// @ts-check
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROOT } from "../lib/repo.mjs";
import { freezeProblems, parseMigrations, releasedMigrations } from "../migrations-freeze.mjs";

const source = (/** @type {string[]} */ ...entries) =>
  `const MIGRATIONS: &[(u32, &str)] = &[\n${entries.join("\n")}\n];\n`;
const entry = (/** @type {number} */ version, /** @type {string} */ sql, comment = "") =>
  `    (\n        ${version},\n${comment ? `        // ${comment}\n` : ""}        "${sql}",\n    ),`;

describe("migrations-freeze", () => {
  it("passes on the repo as it is", () => {
    const current = parseMigrations(readFileSync(join(ROOT, "core/store/src/lib.rs"), "utf8"));
    expect(current.size).toBeGreaterThanOrEqual(14);
    expect(freezeProblems(releasedMigrations(), current)).toEqual([]);
  });

  it("ignores comments and layout", () => {
    const released = parseMigrations(source(entry(1, "-- a table\n         CREATE TABLE a (x);")));
    const current = parseMigrations(
      source(entry(1, "CREATE  TABLE a (x);", "Decision 0001."), entry(2, "CREATE TABLE b (y);")),
    );
    expect(freezeProblems(new Map([["core-v0.1.0", released]]), current, [])).toEqual([]);
  });

  it("fails when a released migration is removed or edited", () => {
    const released = parseMigrations(
      source(entry(1, "CREATE TABLE a (x);"), entry(2, "ALTER TABLE a ADD COLUMN y;")),
    );
    expect(
      freezeProblems(new Map([["core-v0.2.0", released]]), parseMigrations(source()), []),
    ).toEqual([
      "migration 1 released in core-v0.2.0 is gone from core/store/src/lib.rs",
      "migration 2 released in core-v0.2.0 is gone from core/store/src/lib.rs",
    ]);
    const edited = parseMigrations(
      source(entry(1, "CREATE TABLE a (x);"), entry(2, "ALTER TABLE a ADD COLUMN z;")),
    );
    expect(freezeProblems(new Map([["core-v0.2.0", released]]), edited, [])).toEqual([
      "migration 2 differs from the one released in core-v0.2.0",
    ]);
  });

  it("lets a known change through only for the releases it names", () => {
    const released = parseMigrations(source(entry(1, "CREATE TABLE a (x);")));
    const known = [{ version: 1, tags: ["core-v0.1.0"], reason: "test" }];
    const tags = new Map([
      ["core-v0.1.0", released],
      ["core-v0.1.1", released],
    ]);
    expect(freezeProblems(tags, parseMigrations(source()), known)).toEqual([
      "migration 1 released in core-v0.1.1 is gone from core/store/src/lib.rs",
    ]);
  });
});
