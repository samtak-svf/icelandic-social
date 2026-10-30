// @ts-check
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditMigrations, migrationProblems, numberProblems } from "../migration-guard.mjs";
import { copyRepo } from "./helpers.mjs";

const CONTRACT = "-- contract: the posts tables left v1 with decision 0044\n";

describe("numberProblems", () => {
  const onBase = ["0040_a.sql", "0041_b.sql"];

  it("passes a branch with no migration of its own", () => {
    expect(numberProblems(onBase, onBase)).toEqual([]);
  });

  it("passes a new one above the base", () => {
    expect(numberProblems(onBase, [...onBase, "0042_c.sql"])).toEqual([]);
  });

  it("refuses a number the base already took", () => {
    expect(numberProblems(onBase, [...onBase, "0041_c.sql"])).toEqual([
      "0041_c.sql: the base is already at 41",
    ]);
  });

  it("refuses one below the top, which would run out of order on a fresh database", () => {
    expect(numberProblems(onBase, [...onBase, "0039_c.sql"])).toEqual([
      "0039_c.sql: the base is already at 41",
    ]);
  });

  it("refuses two of the branch's own with one number", () => {
    expect(numberProblems(onBase, [...onBase, "0042_c.sql", "0042_d.sql"])).toEqual([
      "0042_d.sql: another migration on this branch has that number",
    ]);
  });

  it("refuses a name without a number", () => {
    expect(numberProblems(onBase, [...onBase, "friends.sql"])).toEqual([
      "friends.sql: not named NNNN_what.sql",
    ]);
  });

  it("does not read a duplicate that is already on the base: no PR could rename it", () => {
    const landed = ["0041_a.sql", "0041_b.sql"];
    expect(numberProblems(landed, [...landed, "0042_c.sql"])).toEqual([]);
  });
});

describe("migration-guard", () => {
  it("passes on the repo as it is", () => {
    const { problems, checked } = auditMigrations();
    expect(checked).toBeGreaterThanOrEqual(17);
    expect(problems).toEqual([]);
  });

  it("passes a migration that only adds", () => {
    expect(
      migrationProblems(
        "0099_add.sql",
        "CREATE TABLE a (x TEXT);\nALTER TABLE a ADD COLUMN y INTEGER;\nCREATE INDEX a_y ON a (y);\n",
      ),
    ).toEqual([]);
  });

  it.each([
    ["DROP TABLE", "DROP TABLE IF EXISTS a;"],
    ["DROP COLUMN", "ALTER TABLE a DROP COLUMN y;"],
    ["DROP INDEX", "drop index a_y;"],
    ["DROP TRIGGER", "DROP TRIGGER a_append_only;"],
    ["DROP VIEW", "DROP VIEW v;"],
    ["RENAME", "ALTER TABLE a RENAME COLUMN y TO z;"],
    ["RENAME", "ALTER TABLE a RENAME TO b;"],
  ])("fails on %s without the contract line", (what, sql) => {
    expect(migrationProblems("0099_x.sql", `-- A comment first.\n${sql}\n`)).toEqual([
      `0099_x.sql: ${what} without a first line "-- contract: <reason>" (decision 0068)`,
    ]);
    expect(migrationProblems("0099_x.sql", `${CONTRACT}${sql}\n`)).toEqual([]);
  });

  it("wants a reason, on the first line", () => {
    expect(migrationProblems("0099_x.sql", "-- contract:\nDROP TABLE a;")).toHaveLength(1);
    expect(migrationProblems("0099_x.sql", "-- contract: x\nDROP TABLE a;")).toHaveLength(1);
    expect(migrationProblems("0099_x.sql", `-- First.\n${CONTRACT}DROP TABLE a;`)).toHaveLength(1);
  });

  it("does not read comments or strings as statements", () => {
    expect(
      migrationProblems(
        "0099_x.sql",
        "-- The old table was dropped by hand; DROP TABLE is not run here.\n" +
          "/* rename later */\nINSERT INTO a (x) VALUES ('DROP TABLE b; RENAME');\n",
      ),
    ).toEqual([]);
  });

  it("fails the audit when a migration in the directory contracts unsaid", () => {
    const root = copyRepo(["backend/migrations"]);
    writeFileSync(join(root, "backend/migrations/0099_drop.sql"), "DROP TABLE jobs;\n");
    expect(auditMigrations(root).problems).toEqual([
      '0099_drop.sql: DROP TABLE without a first line "-- contract: <reason>" (decision 0068)',
    ]);
  });
});
