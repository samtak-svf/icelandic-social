// @ts-check
// D1 migrations expand, and contract only when they say so (decision 0068).
//
// A Worker rollback runs the previous version on the schema the new one
// migrated, since D1 is never rolled back with the code. That is safe only
// while a migration adds: a table, a column, an index. One that drops or
// renames breaks the version before it, so it comes in a later deploy, once
// no live version reads what it removes, and says so on its first line:
//
//   -- contract: <why nothing live reads this any more>
//
// A migration with a dropping or renaming statement and without that line
// fails here. Comments and string literals are not read as SQL.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./lib/repo.mjs";

const MIGRATIONS = "backend/migrations";

/** The statements a version before the migration may depend on. */
const CONTRACTING = [
  { what: "DROP TABLE", pattern: /\bDROP\s+TABLE\b/i },
  { what: "DROP COLUMN", pattern: /\bDROP\s+COLUMN\b/i },
  { what: "DROP INDEX", pattern: /\bDROP\s+INDEX\b/i },
  { what: "DROP TRIGGER", pattern: /\bDROP\s+TRIGGER\b/i },
  { what: "DROP VIEW", pattern: /\bDROP\s+VIEW\b/i },
  { what: "RENAME", pattern: /\bRENAME\b/i },
];

const CONTRACT_LINE = /^--\s*contract:\s*\S.{9,}$/;

/**
 * SQL with its comments and string literals blanked, so only statements match.
 * @param {string} sql
 */
export function statementsOf(sql) {
  return sql
    .replace(/--[^\n]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * @param {string} name the migration's file name
 * @param {string} sql
 * @returns {string[]} problems
 */
export function migrationProblems(name, sql) {
  const found = CONTRACTING.filter(({ pattern }) => pattern.test(statementsOf(sql))).map(
    ({ what }) => what,
  );
  if (found.length === 0) return [];
  const first = sql.split("\n", 1)[0]?.trim() ?? "";
  if (CONTRACT_LINE.test(first)) return [];
  return [
    `${name}: ${found.join(", ")} without a first line "-- contract: <reason>" (decision 0068)`,
  ];
}

/**
 * @param {string} [root]
 * @returns {{ problems: string[], checked: number }}
 */
export function auditMigrations(root = ROOT) {
  const dir = join(root, MIGRATIONS);
  const names = readdirSync(dir).filter((n) => n.endsWith(".sql"));
  const problems = names.flatMap((name) =>
    migrationProblems(name, readFileSync(join(dir, name), "utf8")),
  );
  return { problems, checked: names.length };
}

function main() {
  const { problems, checked } = auditMigrations();
  if (checked === 0) {
    console.error(`✗ no migrations in ${MIGRATIONS}: nothing was checked`);
    process.exit(1);
  }
  if (problems.length === 0) {
    console.log(`✓ ${checked} D1 migrations expand, or say why they contract`);
    return;
  }
  for (const p of problems) console.error(`::error::${p}`);
  console.error(`
A Worker rollback runs the version before on this schema (docs/operations.md).
Add what the new code needs now, and drop or rename in a later migration, once
no live version reads it; that one starts with "-- contract: <reason>".`);
  process.exit(1);
}

if (import.meta.main) main();
