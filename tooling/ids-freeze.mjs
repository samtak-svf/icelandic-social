// @ts-check
// Frozen identifiers guard (docs/decisions/0004).
//
// identifiers/ids.json holds every identifier that cannot change after first
// use: store ids, bundle ids, App Group, database file names, the Kenni client
// id, Cloudflare resource names, the neutral link host. Changing one after
// release orphans installed apps, keychains, push tokens or links already sent.
//
// So a change must be deliberate twice over:
//   1. ids.json must equal ids.lock.json byte for byte. Editing one alone fails.
//   2. With --base <ref> (CI and pre-push), if the lock changed since <ref>,
//      the same range must ADD a record under docs/decisions/.
// Plus ids.json must validate against ids.schema.json, which pins the shapes
// (reverse-DNS ids, `.db` file names, `jurisdiction: "eu"`).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { git, readJson, ROOT } from "./lib/repo.mjs";
import { validate } from "./lib/schema.mjs";

const IDS = "identifiers/ids.json";
const LOCK = "identifiers/ids.lock.json";
const SCHEMA = "identifiers/ids.schema.json";
const DECISIONS = "docs/decisions/";

/**
 * JSON Pointers at which two values differ, for a message that says what
 * changed rather than only that something did.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @param {string} [pointer]
 * @returns {string[]}
 */
export function diffPointers(a, b, pointer = "") {
  const isObject = (/** @type {unknown} */ v) => v !== null && typeof v === "object";
  if (!isObject(a) || !isObject(b)) return Object.is(a, b) ? [] : [pointer || "/"];
  const ra = /** @type {Record<string, unknown>} */ (a);
  const rb = /** @type {Record<string, unknown>} */ (b);
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])];
  return keys.flatMap((key) => diffPointers(ra[key], rb[key], `${pointer}/${key}`));
}

/**
 * The working-tree checks: schema, and ids equal to the lock.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function checkTree(root = ROOT) {
  const ids = readJson(IDS, root);
  const problems = validate(readJson(SCHEMA, root), ids).map((p) => `${IDS} ${p}`);
  const idsText = readFileSync(join(root, IDS), "utf8");
  const lockText = readFileSync(join(root, LOCK), "utf8");
  if (idsText !== lockText) {
    const changed = diffPointers(readJson(LOCK, root), ids);
    const where = changed.length > 0 ? `differs at ${changed.join(", ")}` : "differs in formatting";
    problems.push(
      `${IDS} ${where} from ${LOCK}. A frozen id changes only by editing both files and adding a record under ${DECISIONS} in the same PR.`,
    );
  }
  return problems;
}

/**
 * The history check: a lock change since `base` needs a new decision record.
 *
 * @param {string} base git ref to compare against (merge base is used)
 * @param {string} [root]
 * @returns {string[]}
 */
export function checkRange(base, root = ROOT) {
  const range = `${base}...HEAD`;
  const lockChanged = git(["diff", "--name-only", range, "--", LOCK], root).trim() !== "";
  if (!lockChanged) return [];
  const added = git(["diff", "--name-only", "--diff-filter=A", range, "--", DECISIONS], root)
    .split("\n")
    .filter((f) => f.endsWith(".md"));
  if (added.length > 0) return [];
  return [
    `${LOCK} changed since ${base} but no record was added under ${DECISIONS}. Write one saying which id changed, why, and what the change orphans.`,
  ];
}

/** @param {string[]} argv */
function baseArg(argv) {
  const i = argv.indexOf("--base");
  return i === -1 ? undefined : argv[i + 1];
}

function main() {
  const base = baseArg(process.argv);
  const problems = checkTree();
  if (base) problems.push(...checkRange(base));
  if (problems.length > 0) {
    for (const p of problems) console.error(`::error file=${IDS}::${p}`);
    process.exit(1);
  }
  console.log(
    `✓ frozen ids valid and equal to the lock${base ? `; no unrecorded change since ${base}` : ""}`,
  );
}

if (import.meta.main) main();
