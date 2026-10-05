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
//
// And the interim Apple ids (decision 0011) are kept apart from the frozen
// ones: an app that has only been on TestFlight cannot be transferred between
// teams, so a frozen id registered on the interim team would stay there.
//
// And in CI the repository must be the one services.githubSlug names
// (decision 0012), so a move to another repo is a recorded lock edit too.

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
 * The interim Apple ids must extend the frozen ones without equalling them,
 * the notification service must sit under its app id (Apple requires it),
 * and the interim team must not be the frozen team.
 *
 * @param {any} ids parsed ids.json, already schema-valid
 * @returns {string[]}
 */
export function checkInterim(ids) {
  const interim = ids.appleInterim;
  if (!interim) return [];
  const { store, services } = ids;
  /** @type {string[]} */
  const problems = [];
  /**
   * @param {string} key
   * @param {string} frozen
   */
  const apart = (key, frozen) => {
    const value = interim[key];
    if (value === frozen) {
      problems.push(`/appleInterim/${key}: is the frozen id ${frozen}; the interim needs its own`);
    } else if (!value.startsWith(`${frozen}.`)) {
      problems.push(`/appleInterim/${key}: must extend the frozen id, as ${frozen}.<suffix>`);
    }
  };
  apart("iosBundleId", store.iosBundleId);
  apart("appGroup", store.appGroup);
  if (interim.iosNotificationServiceBundleId === store.iosNotificationServiceBundleId) {
    apart("iosNotificationServiceBundleId", store.iosNotificationServiceBundleId);
  } else if (!interim.iosNotificationServiceBundleId.startsWith(`${interim.iosBundleId}.`)) {
    problems.push(
      `/appleInterim/iosNotificationServiceBundleId: must sit under the interim app id, as ${interim.iosBundleId}.<suffix>`,
    );
  }
  if (interim.teamId === services.appleTeamId) {
    problems.push(`/appleInterim/teamId: is the frozen team; an interim is another team`);
  }
  return problems;
}

/**
 * In CI, the repository must be the one the lock names. A fork under another
 * owner runs its own CI under its own name, so only the owner's repos are held
 * to it; outside CI (`repository` unset) there is nothing to compare.
 *
 * @param {any} ids parsed ids.json
 * @param {string | undefined} repository `owner/name`, from GITHUB_REPOSITORY
 * @returns {string[]}
 */
export function checkRepository(ids, repository) {
  if (!repository) return [];
  const slug = ids.services.githubSlug;
  const owner = (/** @type {string} */ s) => s.split("/")[0]?.toLowerCase();
  if (owner(repository) !== owner(slug)) return [];
  if (repository.toLowerCase() === slug.toLowerCase()) return [];
  return [
    `/services/githubSlug: is ${slug}, but this runs in ${repository}. A move to another repo is a lock edit with a record under ${DECISIONS}.`,
  ];
}

/**
 * The working-tree checks: schema, the interim ids, and ids equal to the lock.
 *
 * @param {string} [root]
 * @returns {string[]}
 */
export function checkTree(root = ROOT) {
  const ids = readJson(IDS, root);
  const problems = validate(readJson(SCHEMA, root), ids).map((p) => `${IDS} ${p}`);
  if (problems.length === 0) problems.push(...checkInterim(ids).map((p) => `${IDS} ${p}`));
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
  problems.push(
    ...checkRepository(readJson(IDS), process.env.GITHUB_REPOSITORY).map((p) => `${IDS} ${p}`),
  );
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
