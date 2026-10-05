// @ts-check
// PII guard: keep kennitölur and phone numbers out of git.
//
// Ported from samtak-vefur tooling/pii-guard.mjs (#423), where the gap was
// found the hard way: gitleaks matches secret SHAPES and a kennitala is not
// one, so a founder's kennitala and phone number sat one `git add .` from the
// history. Here the stakes are higher: a messenger's test fixtures, logs and
// support notes are exactly where a user's number gets pasted
// (docs/decisions/0008).
//
// `node tooling/pii-guard.mjs`          every visible file
// `node tooling/pii-guard.mjs --staged` only what is staged (pre-commit)
//
// Detection is checksum-based rather than shape-based, which is what makes it
// usable as a hard gate: `\d{6}-\d{4}` alone matches dates, amounts and ids
// constantly, but only ~1 in 11 random ten-digit runs survives the mod-11
// check digit, and fewer still carry a valid date. That precision is the
// difference between a check people fix and a check people bypass.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ROOT, stagedFiles, visibleFiles } from "./lib/repo.mjs";

/** Weights applied to the first eight digits, per Þjóðskrá's mod-11 scheme. */
const CHECK_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];

/** Century marker in position 10: 8 = 1800s, 9 = 1900s, 0 = 2000s. */
const CENTURY_DIGITS = new Set([0, 8, 9]);

/**
 * Structural validity of a ten-digit kennitala, date and check digit included.
 *
 * `kind` distinguishes the two populations, because only one of them is PII:
 * a company's kennitala (day + 40) is public registry data that founding
 * documents legitimately quote, while a person's is the thing being protected.
 *
 * @param {string} digits ten digits, no separator
 * @returns {{ valid: boolean, kind: "person" | "company" | null }}
 */
export function classifyKennitala(digits) {
  const miss = { valid: false, kind: null };
  if (!/^\d{10}$/.test(digits)) return miss;

  const n = (/** @type {number} */ i) => Number(digits[i]);

  // Companies are registered with 40 added to the day of the month, which is
  // why 41–71 is a valid "day" here and 32–40 is not.
  const day = n(0) * 10 + n(1);
  const isCompany = day > 40;
  const calendarDay = isCompany ? day - 40 : day;
  if (calendarDay < 1 || calendarDay > 31) return miss;

  const month = n(2) * 10 + n(3);
  if (month < 1 || month > 12) return miss;

  if (!CENTURY_DIGITS.has(n(9))) return miss;

  const sum = CHECK_WEIGHTS.reduce((acc, w, i) => acc + w * n(i), 0);
  const remainder = sum % 11;
  // A remainder of 1 would demand a check digit of 10, so Þjóðskrá never
  // issues that combination at all.
  if (remainder === 1) return miss;
  const expected = remainder === 0 ? 0 : 11 - remainder;
  if (n(8) !== expected) return miss;

  return { valid: true, kind: isCompany ? "company" : "person" };
}

/** Convenience wrapper for the case the guard actually acts on. */
/** @param {string} digits */
export function isPersonKennitala(digits) {
  return classifyKennitala(digits).kind === "person";
}

// Written as `+354` + seven digits, optionally spaced or hyphenated the way a
// person would type it. A bare seven-digit run is deliberately NOT matched:
// it collides with version codes, prices and ids often enough that the check
// would be noise, and the country code is present on every phone number that
// has ever reached this repo (Kenni hands back E.164, and so does the roster).
const PHONE_RE = /\+354[\s-]?\d{3}[\s-]?\d{4}\b/g;

const KENNITALA_RE = /\b\d{6}[\s-]?\d{4}\b/g;

/**
 * Paths whose ten-digit runs are not roster data. Kept deliberately short —
 * every entry is a hole in the gate, so the bar is "this file cannot contain
 * a member's kennitala by construction", not "this file is noisy".
 */
const SKIPPED = [
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)node_modules\//,
  /\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|woff2?|ttf|otf|zip|jar|docx?|xlsx?)$/i,
];

/**
 * Kennitölur that are allowed to appear because they identify nobody, or
 * identify a body whose number is public. Each needs a reason, and a person's
 * kennitala never belongs here — the fix for a real one is to remove it, not
 * to list it.
 */
export const ALLOWED = /** @type {Map<string, string>} */ (new Map([]));

/**
 * Phone numbers allowed to appear, keyed as written without spaces or hyphens
 * (`+354XXXXXXX`), valued by the reason. The population is a BODY's published
 * number — a vendor's switchboard in an archived .eml signature, a public
 * office — never a person's mobile, whose fix is removal. Empty until a real
 * case lists one; the mechanism exists so that keeping a published number is a
 * reason in this file rather than a `[redacted]` nobody can explain later.
 */
export const ALLOWED_PHONES = /** @type {Map<string, string>} */ (new Map([]));

/** @param {string} file */
function isSkipped(file) {
  return SKIPPED.some((re) => re.test(file));
}

/**
 * Scan one file's text. Split out from the file walk so the tests can exercise
 * the matching without touching the working tree.
 *
 * @param {string} file path, for reporting
 * @param {string} text file contents
 * @returns {Array<{ file: string, line: number, kind: string, match: string }>}
 */
export function findInText(file, text) {
  /** @type {Array<{ file: string, line: number, kind: string, match: string }>} */
  const findings = [];
  const lines = text.split("\n");

  lines.forEach((line, i) => {
    for (const m of line.matchAll(KENNITALA_RE)) {
      const digits = m[0].replace(/[\s-]/g, "");
      if (ALLOWED.has(digits)) continue;
      if (!isPersonKennitala(digits)) continue;
      findings.push({ file, line: i + 1, kind: "kennitala", match: redact(m[0]) });
    }
    for (const m of line.matchAll(PHONE_RE)) {
      if (ALLOWED_PHONES.has(m[0].replace(/[\s-]/g, ""))) continue;
      findings.push({ file, line: i + 1, kind: "phone", match: redact(m[0]) });
    }
  });

  return findings;
}

/**
 * Report enough of the match to locate it, never the whole value — a CI log is
 * public-ish and printing the number in full would leak exactly what the check
 * exists to contain.
 */
/** @param {string} value */
function redact(value) {
  return `${value.slice(0, 4)}${"•".repeat(Math.max(0, value.length - 4))}`;
}

/**
 * @param {string[]} files repo-relative
 * @param {string} [root]
 * @returns {Array<{ file: string, line: number, kind: string, match: string }>}
 */
export function findPii(files, root = ROOT) {
  /** @type {Array<{ file: string, line: number, kind: string, match: string }>} */
  const findings = [];
  for (const file of files) {
    if (isSkipped(file)) continue;
    let text;
    try {
      if (statSync(join(root, file)).size > 2 * 1024 * 1024) continue;
      text = readFileSync(join(root, file), "utf8");
    } catch {
      continue; // deleted, unreadable, or binary enough to throw
    }
    if (text.includes("\0")) continue;
    findings.push(...findInText(file, text));
  }
  return findings;
}

function main() {
  const staged = process.argv.includes("--staged");
  const files = staged ? stagedFiles() : visibleFiles();
  const findings = findPii(files);
  if (findings.length === 0) {
    console.log(
      `✓ no kennitala or phone number in ${files.length} ${staged ? "staged" : "visible"} file(s)`,
    );
    return;
  }
  for (const f of findings) {
    console.error(
      `::error file=${f.file},line=${f.line}::${f.kind} in ${f.file}:${f.line} (${f.match})`,
    );
  }
  console.error(`
${findings.length} PII finding(s). Kennitölur and phone numbers never enter git
(AGENTS.md § PII, docs/decisions/0008). Keep real data in the gitignored
private/ dir, or replace an example with a placeholder.

Values are shown truncated on purpose. A false positive (a number that
identifies nobody) goes in ALLOWED in tooling/pii-guard.mjs with the reason.
A real person's kennitala is never a false positive.`);
  process.exit(1);
}

if (import.meta.main) main();
