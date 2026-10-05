// @ts-check
// Seam guard for the Worker (plan §4, decision 0001).
//
// 1. Only `backend/src/env/` reads a binding, a var or a secret. Their names
//    come from `backend/wrangler.jsonc` and `backend/.dev.vars.example`, so a
//    new binding is covered the moment it is configured.
// 2. A Durable Object id or stub is made only in `backend/src/env/`, and only
//    as `<namespace>.jurisdiction("eu").<idFromName|idFromString|newUniqueId|getByName>(…)`.
//    A namespace has no jurisdiction of its own; a bare `idFromName` creates
//    the object wherever Cloudflare chooses, and it can never be moved.
// 3. No `jurisdiction(…)` other than "eu", anywhere.
//
// Matching runs on source with comments and strings blanked, so a comment or
// a log line naming a binding is not a violation (tooling/lib/source.mjs).
// Tests are not scanned: they build their own env on purpose.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, visibleFiles } from "./lib/repo.mjs";
import { lineOf, parseJsonc, stripCommentsAndStrings } from "./lib/source.mjs";

const SRC = "backend/src/";
const SEAM = "backend/src/env/";
const ID_METHODS = /\b(idFromName|idFromString|newUniqueId|getByName)\s*\(/g;
const PINNED_EU = /\.\s*jurisdiction\s*\(\s*(["'`])eu\1\s*\)\s*\.\s*$/;
const ANY_JURISDICTION = /\.\s*jurisdiction\s*\(([^)]*)\)/g;

/**
 * @typedef {{ file: string, line: number, rule: string, message: string }} Violation
 */

/**
 * Every name a Worker reads from `env`: bindings and vars from the wrangler
 * config, secrets from `.dev.vars.example` (names only, values are fake).
 *
 * @param {any} config parsed wrangler.jsonc
 * @param {string} [devVarsExample] contents of `.dev.vars.example`
 * @returns {string[]}
 */
export function bindingNames(config, devVarsExample = "") {
  /** @type {string[]} */
  const names = [];
  for (const key of ["d1_databases", "r2_buckets", "kv_namespaces", "services", "queues"]) {
    for (const entry of config[key] ?? []) names.push(entry.binding);
  }
  for (const entry of config.durable_objects?.bindings ?? []) names.push(entry.name);
  names.push(...Object.keys(config.vars ?? {}));
  for (const line of devVarsExample.split("\n")) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match?.[1]) names.push(match[1]);
  }
  return [...new Set(names.filter(Boolean))].sort();
}

/**
 * @param {string} file repo-relative path
 * @param {string} source
 * @param {string[]} bindings
 * @returns {Violation[]}
 */
export function findInSource(file, source, bindings) {
  const code = stripCommentsAndStrings(source);
  const inSeam = file.startsWith(SEAM);
  /** @type {Violation[]} */
  const found = [];
  const add = (
    /** @type {number} */ offset,
    /** @type {string} */ rule,
    /** @type {string} */ message,
  ) => found.push({ file, line: lineOf(source, offset), rule, message });

  if (!inSeam && bindings.length > 0) {
    const names = new RegExp(`\\b(${bindings.join("|")})\\b`, "g");
    for (const match of code.matchAll(names)) {
      add(match.index, "binding", `reads ${match[1]} outside ${SEAM}; take it from the seam`);
    }
  }

  for (const match of code.matchAll(ID_METHODS)) {
    if (!inSeam) {
      add(match.index, "do-stub", `${match[1]}() outside ${SEAM}; make stubs there`);
    } else if (!PINNED_EU.test(source.slice(0, match.index))) {
      add(
        match.index,
        "do-jurisdiction",
        `${match[1]}() without .jurisdiction("eu") right before it`,
      );
    }
  }

  for (const match of code.matchAll(ANY_JURISDICTION)) {
    const argument = source.slice(match.index, match.index + match[0].length);
    if (!/\(\s*(["'`])eu\1\s*\)$/.test(argument)) {
      add(match.index, "do-jurisdiction", `jurisdiction other than "eu": ${argument.trim()}`);
    }
  }
  return found;
}

/**
 * @param {string} [root]
 * @returns {{ files: number, violations: Violation[] }}
 */
export function findViolations(root = ROOT) {
  const config = parseJsonc(readFileSync(join(root, "backend/wrangler.jsonc"), "utf8"));
  const example = join(root, "backend/.dev.vars.example");
  const bindings = bindingNames(config, existsSync(example) ? readFileSync(example, "utf8") : "");
  const files = visibleFiles(root).filter((f) => f.startsWith(SRC) && /\.[cm]?[jt]s$/.test(f));
  const violations = files.flatMap((file) =>
    findInSource(file, readFileSync(join(root, file), "utf8"), bindings),
  );
  return { files: files.length, violations };
}

function main() {
  const { files, violations } = findViolations();
  if (violations.length === 0) {
    console.log(`✓ seams intact in ${files} file(s) under ${SRC}`);
    return;
  }
  for (const v of violations) {
    console.error(`::error file=${v.file},line=${v.line}::${v.rule}: ${v.message}`);
  }
  console.error(`
${violations.length} seam violation(s). Bindings, secrets and Durable Object
stubs go through ${SEAM} only, and every stub is pinned with
.jurisdiction("eu") (AGENTS.md § Infrastructure, docs/decisions/0001).`);
  process.exit(1);
}

if (import.meta.main) main();
