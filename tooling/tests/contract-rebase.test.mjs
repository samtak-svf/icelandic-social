// @ts-check
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rebaseOn, renumbered, settleNumbers } from "../contract-rebase.mjs";
import { ROOT } from "../lib/repo.mjs";
import { git, initRepo, tempDir } from "./helpers.mjs";

const GENERATED = "api/openapi.json";
const SOURCE = "backend/src/schema.ts";
const MIGRATIONS = "backend/migrations";

/**
 * A repo with the real .gitattributes, a generated file, a source file and one
 * migration, on main.
 */
function repo() {
  const root = tempDir("spjall-contract-");
  cpSync(join(ROOT, ".gitattributes"), join(root, ".gitattributes"));
  for (const dir of ["api", "backend/src", MIGRATIONS]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  writeFileSync(join(root, GENERATED), "base\n");
  writeFileSync(join(root, SOURCE), "base\n");
  writeFileSync(join(root, MIGRATIONS, "0040_base.sql"), "CREATE TABLE a (x TEXT);\n");
  initRepo(root);
  // rebaseOn commits with the repo's own git, and a CI runner has no identity of its own.
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  return root;
}

/**
 * @param {string} root
 * @param {Record<string, string>} files
 */
function commit(root, files) {
  for (const [path, text] of Object.entries(files)) {
    writeFileSync(join(root, path), text);
    git(root, ["add", "--", path]);
  }
  git(root, ["commit", "-q", "-m", "change"]);
}

/**
 * main moves on with `onMain`, and the branch holds `onBranch` from before that.
 * @param {string} root
 * @param {Record<string, string>} onMain
 * @param {Record<string, string>} onBranch
 */
function sideBySide(root, onMain, onBranch) {
  git(root, ["switch", "-q", "-c", "side"]);
  commit(root, onBranch);
  git(root, ["switch", "-q", "main"]);
  commit(root, onMain);
  git(root, ["switch", "-q", "side"]);
}

describe("renumbered", () => {
  it("leaves a branch alone that is already above the base", () => {
    expect(renumbered(["0040_a.sql"], ["0041_b.sql", "0042_c.sql"])).toEqual([]);
  });

  it("keeps a gap: only an order that is wrong moves", () => {
    expect(renumbered(["0040_a.sql"], ["0045_b.sql"])).toEqual([]);
  });

  it("moves a number the base took", () => {
    expect(renumbered(["0040_a.sql", "0041_x.sql"], ["0041_b.sql"])).toEqual([
      { from: "0041_b.sql", to: "0042_b.sql" },
    ]);
  });

  it("keeps the branch's order, highest first so no rename lands on another", () => {
    expect(renumbered(["0041_x.sql"], ["0041_b.sql", "0042_b.sql"])).toEqual([
      { from: "0042_b.sql", to: "0043_b.sql" },
      { from: "0041_b.sql", to: "0042_b.sql" },
    ]);
  });

  it("separates two of its own with one number", () => {
    expect(renumbered(["0040_a.sql"], ["0041_b.sql", "0041_c.sql"])).toEqual([
      { from: "0041_c.sql", to: "0042_c.sql" },
    ]);
  });

  it("changes nothing the second time", () => {
    const [{ to } = { to: "" }] = renumbered(["0041_x.sql"], ["0041_b.sql"]);
    expect(renumbered(["0041_x.sql"], [to])).toEqual([]);
  });
});

describe("rebaseOn", () => {
  it("does not stop on a generated file both sides changed", () => {
    const root = repo();
    sideBySide(root, { [GENERATED]: "main\n" }, { [GENERATED]: "branch\n" });

    expect(rebaseOn("main", root)).toBe(true);
    expect(readFileSync(join(root, GENERATED), "utf8")).toBe("main\n");
    expect(existsSync(join(root, ".git/rebase-merge"))).toBe(false);
  });

  it("the attribute is what does it: a plain rebase stops on the same pair", () => {
    const root = repo();
    sideBySide(root, { [GENERATED]: "main\n" }, { [GENERATED]: "branch\n" });

    expect(() => git(root, ["rebase", "main"])).toThrow();
  });

  it("stops on a source file both sides changed", () => {
    const root = repo();
    sideBySide(root, { [SOURCE]: "main\n" }, { [SOURCE]: "branch\n" });

    expect(rebaseOn("main", root)).toBe(false);
    expect(existsSync(join(root, ".git/rebase-merge"))).toBe(true);
  });

  it("carries the branch's source past a generated conflict", () => {
    const root = repo();
    sideBySide(root, { [GENERATED]: "main\n" }, { [GENERATED]: "branch\n", [SOURCE]: "branch\n" });

    expect(rebaseOn("main", root)).toBe(true);
    expect(readFileSync(join(root, SOURCE), "utf8")).toBe("branch\n");
  });
});

describe("settleNumbers", () => {
  it("moves the branch's migration and leaves main's", () => {
    const root = repo();
    sideBySide(
      root,
      { [`${MIGRATIONS}/0041_main.sql`]: "CREATE TABLE m (x TEXT);\n" },
      { [`${MIGRATIONS}/0041_mine.sql`]: "CREATE TABLE b (x TEXT);\n" },
    );
    expect(rebaseOn("main", root)).toBe(true);

    expect(settleNumbers("main", root)).toEqual([{ from: "0041_mine.sql", to: "0042_mine.sql" }]);
    expect(existsSync(join(root, MIGRATIONS, "0041_main.sql"))).toBe(true);
    expect(existsSync(join(root, MIGRATIONS, "0042_mine.sql"))).toBe(true);
    expect(existsSync(join(root, MIGRATIONS, "0041_mine.sql"))).toBe(false);
  });

  it("takes along a file that names the migration", () => {
    const root = repo();
    sideBySide(
      root,
      { [`${MIGRATIONS}/0041_main.sql`]: "CREATE TABLE m (x TEXT);\n" },
      {
        [`${MIGRATIONS}/0041_mine.sql`]: "CREATE TABLE b (x TEXT);\n",
        [SOURCE]: 'read("0041_mine.sql");\n',
      },
    );
    expect(rebaseOn("main", root)).toBe(true);

    settleNumbers("main", root);
    expect(readFileSync(join(root, SOURCE), "utf8")).toBe('read("0042_mine.sql");\n');
    expect(git(root, ["diff", "--name-only"])).toBe("");
  });

  it("does nothing when the numbers are right", () => {
    const root = repo();
    sideBySide(
      root,
      { [SOURCE]: "main\n" },
      { [`${MIGRATIONS}/0041_mine.sql`]: "CREATE TABLE b (x TEXT);\n" },
    );
    expect(rebaseOn("main", root)).toBe(true);

    expect(settleNumbers("main", root)).toEqual([]);
    expect(git(root, ["diff", "--cached", "--name-only"])).toBe("");
  });
});
