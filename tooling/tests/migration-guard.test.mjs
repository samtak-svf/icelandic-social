// @ts-check
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { auditMigrations, migrationProblems } from "../migration-guard.mjs";
import { copyRepo } from "./helpers.mjs";

const CONTRACT = "-- contract: the posts tables left v1 with decision 0044\n";

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
