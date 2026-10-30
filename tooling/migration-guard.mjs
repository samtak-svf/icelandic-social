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
//
// With --base <ref> it also holds the order (#397): a migration the base does not
// have takes a number above all of the base's, so two branches that each took the
// next number find out at the PR, and `node tooling/contract-rebase.mjs` settles it.
// Only what is new is read. A duplicate that a stale green PR has already landed on
// main is harmless, since cf records a migration by its file name, and a rule over
// the whole tree would then fail every PR for something none of them can rename.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git, ROOT } from "./lib/repo.mjs";

export const MIGRATIONS = "backend/migrations";

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

/**
 * @param {string} name a migration's file name
 * @returns {number}
 */
export function numberOf(name) {
  return Number(name.slice(0, 4));
}

/**
 * The migrations a commit holds, by file name.
 * @param {string} ref
 * @param {string} [root]
 * @returns {string[]}
 */
export function migrationsAt(ref, root = ROOT) {
  return git(["ls-tree", "--name-only", ref, `${MIGRATIONS}/`], root)
    .split("\n")
    .filter((path) => path.endsWith(".sql"))
    .map((path) => path.slice(MIGRATIONS.length + 1));
}

/**
 * @param {string[]} onBase file names on the base
 * @param {string[]} onHead file names on the branch
 * @returns {string[]} problems, for the files the base does not have
 */
export function numberProblems(onBase, onHead) {
  const top = Math.max(0, ...onBase.map(numberOf));
  const own = onHead.filter((name) => !onBase.includes(name));
  return own.flatMap((name) => {
    if (!/^\d{4}_.+\.sql$/.test(name)) return [`${name}: not named NNNN_what.sql`];
    if (numberOf(name) <= top) return [`${name}: the base is already at ${top}`];
    if (own.some((other) => other < name && numberOf(other) === numberOf(name))) {
      return [`${name}: another migration on this branch has that number`];
    }
    return [];
  });
}

function main() {
  const baseAt = process.argv.indexOf("--base");
  const base = baseAt === -1 ? null : process.argv[baseAt + 1];
  if (baseAt !== -1 && !base) {
    console.error("✗ --base needs a ref");
    process.exit(1);
  }

  const { problems, checked } = auditMigrations();
  if (checked === 0) {
    console.error(`✗ no migrations in ${MIGRATIONS}: nothing was checked`);
    process.exit(1);
  }
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length > 0) {
    console.error(`
A Worker rollback runs the version before on this schema (docs/operations.md).
Add what the new code needs now, and drop or rename in a later migration, once
no live version reads it; that one starts with "-- contract: <reason>".`);
  }

  const order = base ? numberProblems(migrationsAt(base), migrationsAt("HEAD")) : [];
  for (const p of order) console.error(`::error::${p}`);
  if (order.length > 0) {
    console.error(`
Another branch took the number first. \`node tooling/contract-rebase.mjs\` puts this
branch on main and moves its own migrations above main's.`);
  }

  if (problems.length > 0 || order.length > 0) process.exit(1);
  console.log(`✓ ${checked} D1 migrations expand, or say why they contract`);
  if (base) console.log(`✓ the ones ${base} does not have are numbered above it`);
}

if (import.meta.main) main();
