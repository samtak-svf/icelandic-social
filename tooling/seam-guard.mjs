// @ts-check
// Seam guard for the Worker (plan §4, decision 0001).
//
// 1. Only `backend/src/env/` reads a binding, a var or a secret. Their names
//    come from the Worker config (tooling/lib/worker-config.mjs) and the
//    secrets table of tooling/worker-secrets.mjs, so a new binding is covered
//    the moment it is configured.
// 2. A Durable Object id or stub is made only in `backend/src/env/`, and only
//    as `<namespace>.jurisdiction("eu").<idFromName|idFromString|newUniqueId|getByName>(…)`.
//    A namespace has no jurisdiction of its own; a bare `idFromName` creates
//    the object wherever Cloudflare chooses, and it can never be moved.
// 3. No `jurisdiction(…)` other than "eu", anywhere.
// 4. No `console.*` outside `backend/src/log.ts`, the one helper that writes
//    allow-listed fields only (decision 0008).
//
// Matching runs on source with comments and strings blanked, so a comment or
// a log line naming a binding is not a violation (tooling/lib/source.mjs).
// Tests are not scanned: they build their own env on purpose.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, visibleFiles } from "./lib/repo.mjs";
import { lineOf, stripCommentsAndStrings } from "./lib/source.mjs";
import { configuredNames, readWorkerConfig } from "./lib/worker-config.mjs";
import { SECRETS } from "./worker-secrets.mjs";

const SRC = "backend/src/";
const SEAM = "backend/src/env/";
const LOG_HELPER = "backend/src/log.ts";
const CONSOLE = /\bconsole\s*\.\s*[A-Za-z_$]/g;
const ID_METHODS = /\b(idFromName|idFromString|newUniqueId|getByName)\s*\(/g;
const PINNED_EU = /\.\s*jurisdiction\s*\(\s*(["'`])eu\1\s*\)\s*\.\s*$/;
const ANY_JURISDICTION = /\.\s*jurisdiction\s*\(([^)]*)\)/g;

/**
 * @typedef {{ file: string, line: number, rule: string, message: string }} Violation
 */

/**
 * Every name a Worker reads from `env`: what the config declares, and the
 * secrets, which a config never holds.
 *
 * @param {import("./lib/worker-config.mjs").WorkerConfig} config
 * @param {string[]} [secrets]
 * @returns {string[]}
 */
export function bindingNames(config, secrets = SECRETS.map((s) => s.name)) {
  return [...new Set([...configuredNames(config), ...secrets].filter(Boolean))].sort();
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

  if (file !== LOG_HELPER) {
    for (const match of code.matchAll(CONSOLE)) {
      add(match.index, "console", `console outside ${LOG_HELPER}; log through it (decision 0008)`);
    }
  }
  return found;
}

/**
 * @param {string} [root]
 * @returns {{ files: number, violations: Violation[] }}
 */
export function findViolations(root = ROOT) {
  const bindings = bindingNames(readWorkerConfig(root));
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
.jurisdiction("eu") (AGENTS.md § Infrastructure, docs/decisions/0001). Logging
goes through ${LOG_HELPER} only (docs/decisions/0008).`);
  process.exit(1);
}

if (import.meta.main) main();
