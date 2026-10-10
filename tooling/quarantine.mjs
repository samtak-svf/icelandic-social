// @ts-check
// Quarantine guard (docs/testing.md § Known sources of noise, item 1).
//
// A skipped test is a rule nobody holds. Every skip marker in the tree
// (vitest skip/todo/skipIf, Rust #[ignore], Kotlin @Ignore, Swift XCTSkip)
// needs an entry in tooling/quarantine.json:
//   - quarantined: an `issue` and an `until` at most 14 days ahead; the entry
//     fails `pnpm check` once `until` has passed, so a flaky test is fixed or
//     deleted on purpose, never left skipped;
//   - permanent: a `reason`, for a test that is not meant to run in the suite
//     (a fixture writer, a test another workflow runs).
// An entry whose marker is gone fails too, so the list never outlives the skip.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, ROOT, visibleFiles } from "./lib/repo.mjs";

const LIST = "tooling/quarantine.json";
const MAX_DAYS = 14;
const DAY = 24 * 60 * 60 * 1000;

/** @typedef {{ file: string, name: string, line: number }} Skip */
/** @typedef {{ file: string, name: string, issue?: string, until?: string, reason?: string }} Entry */

/**
 * @param {string} source
 * @param {number} index
 */
const lineAt = (source, index) => source.slice(0, index).split("\n").length;

/**
 * The skip markers in one file, each with the name of the test it skips.
 *
 * @param {string} file
 * @param {string} source
 * @returns {Skip[]}
 */
export function findSkips(file, source) {
  /** @type {[RegExp, (m: RegExpMatchArray, at: number) => string | undefined] | null} */
  const how = /\.(ts|mjs)$/.test(file)
    ? [
        /\b(?:it|test|describe)\.(?:skip|todo|skipIf\([^)]*\))\s*\(\s*(?:(["'`])(.*?)\1)?/g,
        (m) => m[2],
      ]
    : file.endsWith(".rs")
      ? [/#\[ignore\b/g, (_, at) => /\bfn (\w+)/.exec(source.slice(at))?.[1]]
      : file.endsWith(".kt")
        ? [/@Ignore\b/g, (_, at) => /\bfun (\w+|`[^`]+`)/.exec(source.slice(at))?.[1]]
        : file.endsWith(".swift")
          ? [
              /\bXCTSkip\b/g,
              (_, at) => [...source.slice(0, at).matchAll(/\bfunc (\w+)/g)].at(-1)?.[1],
            ]
          : null;
  if (!how) return [];
  const [marker, nameOf] = how;
  return [...source.matchAll(marker)].map((m) => {
    const at = /** @type {number} */ (m.index);
    return { file, name: (nameOf(m, at) ?? "?").replaceAll("`", ""), line: lineAt(source, at) };
  });
}

/**
 * @param {Entry[]} entries
 * @param {Skip[]} skips
 * @param {string} today YYYY-MM-DD
 * @returns {string[]}
 */
export function checkQuarantine(entries, skips, today) {
  const key = (/** @type {{ file: string, name: string }} */ t) => `${t.file}\0${t.name}`;
  const listed = new Map(entries.map((e) => [key(e), e]));
  const marked = new Set(skips.map(key));
  /** @type {string[]} */
  const problems = [];

  for (const s of skips) {
    if (!listed.has(key(s))) {
      problems.push(
        `${s.file}:${s.line}: "${s.name}" is skipped without a ${LIST} entry ` +
          `(an issue and an until at most ${MAX_DAYS} days ahead, or a reason)`,
      );
    }
  }
  const now = Date.parse(today);
  for (const e of entries) {
    const at = `${LIST} "${e.name}" (${e.file})`;
    if (!marked.has(key(e))) problems.push(`${at}: no skip marker left; remove the entry`);
    if (e.reason !== undefined) {
      if (e.issue !== undefined || e.until !== undefined) {
        problems.push(`${at}: a permanent entry has a reason and neither issue nor until`);
      }
      continue;
    }
    if (!e.issue || !/^#\d+$/.test(e.issue)) problems.push(`${at}: needs an issue, as #123`);
    const until = e.until && /^\d{4}-\d{2}-\d{2}$/.test(e.until) ? Date.parse(e.until) : NaN;
    if (Number.isNaN(until)) problems.push(`${at}: needs an until, as YYYY-MM-DD`);
    else if (until < now) problems.push(`${at}: quarantine ended ${e.until}; fix it or delete it`);
    else if (until - now > MAX_DAYS * DAY) {
      problems.push(`${at}: until ${e.until} is more than ${MAX_DAYS} days ahead`);
    }
  }
  return problems;
}

/** @param {string} [root] */
export function findAllSkips(root = ROOT) {
  return visibleFiles(root)
    .filter((f) => /\.(ts|mjs|rs|kt|swift)$/.test(f))
    .flatMap((f) => findSkips(f, readFileSync(join(root, f), "utf8")));
}

function main() {
  const entries = /** @type {{ tests: Entry[] }} */ (readJson(LIST)).tests;
  const skips = findAllSkips();
  const problems = checkQuarantine(entries, skips, new Date().toISOString().slice(0, 10));
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error file=${LIST}::${p}`);
    process.exit(1);
  }
  console.log(`✓ ${skips.length} skipped test(s), each quarantined with an end or a reason`);
}

if (import.meta.main) main();
