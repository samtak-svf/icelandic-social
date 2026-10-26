// @ts-check
// A line limit for Kotlin, Swift and Rust, the same cap TypeScript has.
//
// `.oxlintrc.json` caps TypeScript at `eslint/max-lines`; this guard reuses
// that number for `.kt`, `.swift` and `.rs` files outside any `generated`
// directory, counting every line (blank and comment lines included, as `wc -l`
// does). Files that were already over the cap when the guard landed are listed
// in `tooling/line-count.allow.json` as `{ "path": maxLines }`. The list is a
// ratchet that only shrinks:
//
//   - an unlisted file over the cap fails;
//   - a listed file over its listed maximum fails (it grew);
//   - a listed maximum above the file's real count fails (lower it to the count);
//   - a listed file now at or under the cap fails (remove the entry);
//   - a listed file that no longer exists fails (remove the entry).
//
//   node tooling/line-count.mjs

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, readJson, visibleFiles } from "./lib/repo.mjs";

/** Source files the cap applies to. */
const COUNTED = /\.(kt|swift|rs)$/;

/** Generated code is never hand-split. */
const GENERATED = /(^|\/)generated\//i;

/** The allowlist, relative to the repository root. */
export const ALLOWLIST = "tooling/line-count.allow.json";

/**
 * The cap, read from the TypeScript rule so the two cannot drift apart.
 *
 * @param {string} [root]
 * @returns {number}
 */
export function lineCap(root = ROOT) {
  const text = readFileSync(join(root, ".oxlintrc.json"), "utf8");
  const found = /"eslint\/max-lines"\s*:\s*\[\s*"error"\s*,\s*\{\s*"max"\s*:\s*(\d+)/.exec(text);
  if (!found) throw new Error(".oxlintrc.json: no eslint/max-lines cap found");
  return Number(found[1]);
}

/**
 * @param {string} path repository-relative, forward slashes
 * @returns {boolean}
 */
export function isCounted(path) {
  return COUNTED.test(path) && !GENERATED.test(path);
}

/**
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  if (text === "") return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

/**
 * @param {Record<string, number>} counts line count per counted file
 * @param {Record<string, number>} allow listed maximum per file
 * @param {number} cap
 * @returns {string[]} problems, empty when the ratchet holds
 */
export function check(counts, allow, cap) {
  /** @type {string[]} */
  const problems = [];
  for (const [path, lines] of Object.entries(counts).sort()) {
    const listed = allow[path];
    if (listed === undefined) {
      if (lines > cap) problems.push(`${path}: ${lines} lines, over the cap of ${cap}; split it`);
    } else if (lines > listed) {
      problems.push(`${path}: ${lines} lines, over its allowed ${listed}; it may only shrink`);
    } else if (lines <= cap) {
      problems.push(
        `${path}: ${lines} lines is within the cap of ${cap}; remove it from ${ALLOWLIST}`,
      );
    } else if (lines < listed) {
      problems.push(`${path}: ${lines} lines, allowed ${listed}; lower the entry to ${lines}`);
    }
  }
  for (const path of Object.keys(allow).sort()) {
    if (!(path in counts))
      problems.push(`${path}: listed in ${ALLOWLIST} but not a counted file; remove the entry`);
  }
  return problems;
}

/**
 * @param {string} [root]
 * @returns {Record<string, number>}
 */
export function measure(root = ROOT) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const path of visibleFiles(root).filter(isCounted)) {
    try {
      counts[path] = countLines(readFileSync(join(root, path), "utf8"));
    } catch {
      // listed by git but deleted in the working tree
    }
  }
  return counts;
}

if (import.meta.main) {
  const counts = measure();
  if (Object.keys(counts).length === 0) {
    console.error("❌ no .kt, .swift or .rs file found; the line count measured nothing");
    process.exit(1);
  }
  const cap = lineCap();
  const problems = check(counts, readJson(ALLOWLIST), cap);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`❌ ${problem}`);
    process.exit(1);
  }
  console.log(
    `✓ ${Object.keys(counts).length} Kotlin, Swift and Rust files within ${cap} lines or on the shrink-only list`,
  );
}
