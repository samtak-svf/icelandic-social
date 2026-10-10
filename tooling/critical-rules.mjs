// @ts-check
// Critical-rule registry guard (docs/testing.md § Critical rules).
//
// tooling/critical-rules.json names the rules where a wrong answer harms a
// person, and the tests that hold each one. This guard keeps the list true:
//   1. it matches its schema, ids are unique, and each names a decision record
//      that exists;
//   2. every test it names exists, by its title in a vitest file or its
//      function name in Rust, Kotlin or Swift. A renamed or deleted test fails
//      here instead of leaving a rule silently unheld;
//   3. every rule has a test, or a `gap` issue saying none exists yet.
// With --base <ref> (CI on a PR, pre-push): a test marked `caught` at <ref>,
// one that once caught a real bug, must still be listed or be in `retired`
// with its reason. A pruning pass cannot drop it unnoticed.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GIT_ENV, readJson, ROOT } from "./lib/repo.mjs";
import { validate } from "./lib/schema.mjs";

const REGISTRY = "tooling/critical-rules.json";
const SCHEMA = "tooling/critical-rules.schema.json";
const DECISIONS = "docs/decisions";

/** @typedef {{ file: string, name: string, caught?: string }} TestRef */
/** @typedef {{ id: string, domain: string, decision: string, rule: string, tests: TestRef[], gap?: string }} Rule */
/** @typedef {{ rules: Rule[], retired: { file: string, name: string, reason: string }[] }} Registry */

/** @param {string} text */
function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `source` declares a test called `name`, in the way its language
 * names tests.
 *
 * @param {string} file
 * @param {string} source
 * @param {string} name
 */
export function declares(file, source, name) {
  const n = escape(name);
  if (/\.(ts|mjs)$/.test(file)) {
    return new RegExp(`\\b(?:it|test)\\(\\s*(["'\`])${n}\\1`).test(source);
  }
  if (file.endsWith(".rs")) return new RegExp(`\\bfn ${n}\\s*\\(`).test(source);
  if (file.endsWith(".kt")) return new RegExp(`\\bfun (?:${n}|\`${n}\`)\\s*\\(`).test(source);
  if (file.endsWith(".swift")) return new RegExp(`\\bfunc ${n}\\s*\\(`).test(source);
  return false;
}

/**
 * @param {Registry} registry
 * @param {string} [root]
 * @returns {string[]}
 */
export function checkRegistry(registry, root = ROOT) {
  const problems = validate(readJson(SCHEMA, root), registry);
  if (problems.length > 0) return problems.map((p) => `${REGISTRY} ${p}`);

  const records = new Set(
    readdirSync(join(root, DECISIONS))
      .map((f) => /^(\d{4})-/.exec(f)?.[1])
      .filter(Boolean),
  );
  /** @type {Map<string, string>} */
  const sources = new Map();
  const read = (/** @type {string} */ file) => {
    if (!sources.has(file)) {
      const path = join(root, file);
      sources.set(file, existsSync(path) ? readFileSync(path, "utf8") : "");
    }
    return /** @type {string} */ (sources.get(file));
  };

  const seen = new Set();
  for (const rule of registry.rules) {
    const at = `${REGISTRY} rule ${rule.id}`;
    if (seen.has(rule.id)) problems.push(`${at}: the id is used twice`);
    seen.add(rule.id);
    if (!records.has(rule.decision)) {
      problems.push(`${at}: decision ${rule.decision} has no record in ${DECISIONS}/`);
    }
    if (rule.tests.length === 0 && !rule.gap) {
      problems.push(`${at}: no test holds it; name one, or a gap issue saying none does yet`);
    }
    if (rule.tests.length > 0 && rule.gap) {
      problems.push(`${at}: has tests and a gap; drop the gap once a test holds it`);
    }
    for (const test of rule.tests) {
      const source = read(test.file);
      if (source === "") problems.push(`${at}: ${test.file} does not exist`);
      else if (!declares(test.file, source, test.name)) {
        problems.push(`${at}: ${test.file} has no test "${test.name}" (renamed or removed?)`);
      }
    }
  }
  return problems;
}

/**
 * Tests marked `caught` in `before` that `after` neither lists nor retires.
 *
 * @param {Registry} before
 * @param {Registry} after
 * @returns {string[]}
 */
export function checkCaught(before, after) {
  const key = (/** @type {{ file: string, name: string }} */ t) => `${t.file}\0${t.name}`;
  const kept = new Set([
    ...after.rules.flatMap((r) => r.tests.map(key)),
    ...after.retired.map(key),
  ]);
  return before.rules.flatMap((rule) =>
    rule.tests
      .filter((t) => t.caught && !kept.has(key(t)))
      .map(
        (t) =>
          `${REGISTRY} rule ${rule.id}: "${t.name}" (${t.file}) caught a real bug (${t.caught}); ` +
          `keep it, or move it to "retired" with the reason`,
      ),
  );
}

/**
 * @param {string} base
 * @returns {Registry | null} the registry at `base`, or null before it existed
 */
function registryAt(base) {
  try {
    const text = execFileSync("git", ["show", `${base}:${REGISTRY}`], {
      cwd: ROOT,
      encoding: "utf8",
      env: GIT_ENV,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @param {string[]} argv */
function baseArg(argv) {
  const i = argv.indexOf("--base");
  return i === -1 ? null : (argv[i + 1] ?? null);
}

function main() {
  const registry = /** @type {Registry} */ (readJson(REGISTRY));
  const problems = checkRegistry(registry);
  const base = baseArg(process.argv);
  const before = base ? registryAt(base) : null;
  if (before) problems.push(...checkCaught(before, registry));
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error file=${REGISTRY}::${p}`);
    process.exit(1);
  }
  const tests = registry.rules.reduce((n, r) => n + r.tests.length, 0);
  console.log(
    `✓ ${registry.rules.length} critical rules held by ${tests} named tests` +
      (before ? `; no caught test dropped since ${base}` : ""),
  );
}

if (import.meta.main) main();
