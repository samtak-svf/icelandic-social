// @ts-check
// Released store migrations are frozen (decision 0050).
//
// A device that ran a migration records only its number, so a released
// migration that is later edited, removed or renumbered never runs on that
// device again. Each `core-v*` tag is a release, and its
// `core/store/src/lib.rs` holds the migrations devices may have run. Every
// one of them must still be in `MIGRATIONS` under its number with the same
// SQL (comments and layout aside).
//
// The tags are the only truth here: a lock file in the repo is reverted with
// the code it guards, as the bad rebase in #192 did.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { git, ROOT } from "./lib/repo.mjs";

const STORE = "core/store/src/lib.rs";

/**
 * Migrations released before this guard that a later release changed, with
 * the decision that repairs the stores that ran them.
 * @type {{ version: number, tags: string[], reason: string }[]}
 */
export const KNOWN = [
  {
    version: 14,
    tags: ["core-v0.18.0"],
    reason: "dropped by #192 and reused by 0048; Store::open repairs both histories (0050)",
  },
];

/**
 * The migrations in a store source, by number, with comments and layout
 * removed from their SQL.
 * @param {string} source
 * @returns {Map<number, string>}
 */
export function parseMigrations(source) {
  const start = source.indexOf("const MIGRATIONS");
  if (start < 0) return new Map();
  const end = source.indexOf("\n];", start);
  const body = source.slice(start, end < 0 ? undefined : end);
  /** @type {Map<number, string>} */
  const migrations = new Map();
  const entry = /\(\s*(\d+),\s*(?:\/\/[^\n]*\s*)*"((?:[^"\\]|\\.)*)",?\s*\)/g;
  for (const match of body.matchAll(entry)) {
    migrations.set(Number(match[1]), normalize(match[2] ?? ""));
  }
  return migrations;
}

/** @param {string} sql */
function normalize(sql) {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {Map<string, Map<number, string>>} released by tag
 * @param {Map<number, string>} current
 * @param {typeof KNOWN} [known]
 * @returns {string[]} problems
 */
export function freezeProblems(released, current, known = KNOWN) {
  /** @type {string[]} */
  const problems = [];
  for (const [tag, migrations] of released) {
    for (const [version, sql] of migrations) {
      if (known.some((k) => k.version === version && k.tags.includes(tag))) continue;
      const now = current.get(version);
      if (now === undefined) {
        problems.push(`migration ${version} released in ${tag} is gone from ${STORE}`);
      } else if (now !== sql) {
        problems.push(`migration ${version} differs from the one released in ${tag}`);
      }
    }
  }
  return problems;
}

/**
 * Whether the checkout contains the tag's commit. Exit 1 means it does not;
 * any other failure is a real error.
 * @param {string} tag
 * @param {string} root
 */
function headContains(tag, root) {
  try {
    git(["merge-base", "--is-ancestor", tag, "HEAD"], root);
    return true;
  } catch (error) {
    if (/** @type {{ status?: number }} */ (error).status === 1) return false;
    throw error;
  }
}

/**
 * The migrations of every `core-v*` release the checkout contains. A tag on a
 * commit HEAD lacks (a local main behind the tagged merge) is not judged
 * against a tree that cannot hold its migrations (#294); a branch that does
 * contain the tag still fails when it drops one.
 * @param {string} [root]
 * @returns {Map<string, Map<number, string>>}
 */
export function releasedMigrations(root = ROOT) {
  const tags = git(["tag", "-l", "core-v*"], root).split("\n").filter(Boolean);
  /** @type {Map<string, Map<number, string>>} */
  const released = new Map();
  for (const tag of tags) {
    if (!headContains(tag, root)) continue;
    let source;
    try {
      source = git(["show", `${tag}:${STORE}`], root);
    } catch {
      continue; // before the store existed
    }
    released.set(tag, parseMigrations(source));
  }
  return released;
}

function main() {
  const released = releasedMigrations();
  if (released.size === 0) {
    // A shallow clone has no tags; CI checks out the full history.
    if (process.env.CI) {
      console.error("migrations-freeze: no core-v* tags; check out with fetch-depth: 0");
      process.exit(1);
    }
    console.log("migrations-freeze: no core-v* tags here, nothing to compare");
    return;
  }
  const current = parseMigrations(readFileSync(join(ROOT, STORE), "utf8"));
  const problems = freezeProblems(released, current);
  if (problems.length > 0) {
    console.error("migrations-freeze: a released migration changed (decision 0050):");
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(`✓ no released store migration changed in ${released.size} core release(s)`);
}

if (import.meta.main) main();
