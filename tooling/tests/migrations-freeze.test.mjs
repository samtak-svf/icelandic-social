// @ts-check
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { git, ROOT } from "../lib/repo.mjs";
import { freezeProblems, parseMigrations, releasedMigrations } from "../migrations-freeze.mjs";
import { tempDir } from "./helpers.mjs";

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

  describe("tags and the checkout", () => {
    const STORE = "core/store/src/lib.rs";

    /** A throwaway repository with a store source at each commit it is given. */
    function fixture() {
      const dir = tempDir("spjall-freeze-");
      git(["init", "-q", "-b", "main"], dir);
      git(["config", "user.email", "t@example.invalid"], dir);
      git(["config", "user.name", "t"], dir);
      git(["config", "commit.gpgsign", "false"], dir);
      git(["config", "tag.gpgsign", "false"], dir);
      mkdirSync(join(dir, "core/store/src"), { recursive: true });
      return {
        dir,
        /** @param {string} text @param {string} message */
        commit(text, message) {
          writeFileSync(join(dir, STORE), text);
          git(["add", STORE], dir);
          git(["commit", "-q", "-m", message], dir);
        },
        /** @param {string} name */
        tag: (name) => git(["tag", name], dir),
        problems() {
          const current = parseMigrations(readFileSync(join(dir, STORE), "utf8"));
          return freezeProblems(releasedMigrations(dir), current, []);
        },
      };
    }

    const one = source(entry(1, "CREATE TABLE a (x);"));
    const two = source(entry(1, "CREATE TABLE a (x);"), entry(2, "CREATE TABLE b (y);"));

    it("does not judge a tag on a commit the checkout lacks", () => {
      const repo = fixture();
      repo.commit(one, "one");
      repo.commit(two, "two");
      repo.tag("core-v0.2.0");
      // The checkout lags the tag: it is the commit before the tagged one.
      git(["checkout", "-q", "--detach", "HEAD~1"], repo.dir);
      expect(repo.problems()).toEqual([]);
    });

    it("still fails when the checkout contains the tag and drops a migration", () => {
      const repo = fixture();
      repo.commit(two, "two");
      repo.tag("core-v0.2.0");
      repo.commit(one, "drop migration 2");
      expect(repo.problems()).toEqual([
        `migration 2 released in core-v0.2.0 is gone from ${STORE}`,
      ]);
    });
  });
});
