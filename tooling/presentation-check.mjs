// @ts-check
// The shared presentation vectors are well formed (#275).
//
// `api/presentation.vectors.json` is what the web, Android and iOS tests read
// to prove that relative time, initials, row stamps, problem text and the
// sentence and badge of a notification row agree.
// A vector that names a strings key the contract does not have, a count for a
// key with no {count}, or an instant that does not parse would let all three
// suites pass on nothing, so the file is held to the contract here.
//
//   node tooling/presentation-check.mjs

import { readJson } from "./lib/repo.mjs";

const SECTIONS = /** @type {const} */ ([
  "relativeTime",
  "initials",
  "stamp",
  "listStamp",
  "problem",
  "notice",
]);

/** The badge each notification kind draws on its row's picture (decision 0103). */
const BADGES = /** @type {Record<string, string>} */ ({
  comment: "comment",
  reply: "comment",
  reaction: "emoji",
  join_approved: "approved",
  moderated: "moderator",
});

/** The kinds that name their actors; the others name nobody. */
const SOCIAL = new Set(["comment", "reply", "reaction"]);

/** A UTC instant written the one way every platform parses. */
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isInstant(value) {
  return typeof value === "string" && INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Field checks for one case: each returns the problems it found.
 * @param {any} c one vector case
 * @param {string} where
 */
function fields(c, where) {
  return {
    /** @param {string} field */
    instant: (field) => (isInstant(c?.[field]) ? [] : [`${where}: ${field} is not a UTC instant`]),
    /** @param {string} field */
    text: (field) =>
      typeof c?.[field] === "string" && c[field] !== ""
        ? []
        : [`${where}: ${field} is not a non-empty string`],
    /** @param {Record<string, any>} keys */
    key: (keys) =>
      c?.key in keys ? [] : [`${where}: key ${c?.key} is not in the strings contract`],
  };
}

/**
 * @param {any} c one relativeTime case
 * @param {Record<string, any>} keys the contract's keys
 * @param {string} where
 * @returns {string[]}
 */
function relativeProblems(c, keys, where) {
  const f = fields(c, where);
  const problems = [...f.instant("at"), ...f.instant("now")];
  if (c?.key === null) {
    problems.push(...f.text("expected"));
    if ("count" in c) problems.push(`${where}: a date has no count`);
    return problems;
  }
  const unknown = f.key(keys);
  if (unknown.length > 0) return [...problems, ...unknown];
  const counted = "count" in (keys[c.key].placeholders ?? {});
  if (!counted && "count" in c) problems.push(`${where}: ${c.key} has no {count}`);
  if (counted && !(Number.isInteger(c.count) && c.count >= 1))
    problems.push(`${where}: ${c.key} needs a whole count of 1 or more`);
  return problems;
}

/**
 * The strings key a notification row reads (decisions 0103, 0104).
 * @param {any} c one notice case
 * @returns {string}
 */
function noticeKey(c) {
  if (c.kind === "moderated")
    return c.action === "decline_anonymous_post" ? "notice_anonymous_declined" : "notice_moderated";
  if (!SOCIAL.has(c.kind)) return `notice_${c.kind}`;
  if (c.actorCount >= 3) return `notice_${c.kind}_many`;
  return c.actorCount === 2 ? `notice_${c.kind}_two` : `notice_${c.kind}`;
}

/**
 * @param {any} c one notice case
 * @param {Record<string, any>} keys the contract's keys
 * @param {string} where
 * @returns {string[]}
 */
function noticeProblems(c, keys, where) {
  const shape = noticeShape(c, where);
  if (shape.length > 0) return shape;
  const unknown = fields(c, where).key(keys);
  if (unknown.length > 0) return unknown;
  const problems = [];
  const expected = noticeKey(c);
  if (c.key !== expected)
    problems.push(
      `${where}: ${c.kind} with ${c.actorCount} actors reads ${expected}, not ${c.key}`,
    );
  const args = Object.keys(c.args ?? {}).sort();
  const placeholders = Object.keys(keys[c.key].placeholders ?? {}).sort();
  if (args.join() !== placeholders.join())
    problems.push(
      `${where}: args ${args.join(", ")} differ from ${c.key}'s placeholders ${placeholders.join(", ")}`,
    );
  if (c.badge !== BADGES[c.kind])
    problems.push(`${where}: ${c.kind}'s badge is ${BADGES[c.kind]}, not ${c.badge}`);
  if ("count" in (c.args ?? {}) && c.args.count !== c.actorCount - 1)
    problems.push(
      `${where}: count is actorCount minus one, ${c.actorCount - 1}, not ${c.args.count}`,
    );
  return problems;
}

/**
 * The fields a notice case must have before its rules can be read.
 * @param {any} c one notice case
 * @param {string} where
 * @returns {string[]}
 */
function noticeShape(c, where) {
  if (!(c?.kind in BADGES)) return [`${where}: kind ${c?.kind} is not a notification kind`];
  const actors = Array.isArray(c.actors) ? c.actors : null;
  if (!actors || !actors.every((/** @type {unknown} */ a) => a === null || typeof a === "string"))
    return [`${where}: actors is not a list of names and nulls`];
  if (!Number.isInteger(c.actorCount) || c.actorCount < actors.length)
    return [`${where}: actorCount is not a whole number of at least the actors given`];
  return [];
}

/**
 * @param {string} section
 * @param {any} c one case
 * @param {Record<string, any>} keys the contract's keys
 * @param {string} where
 * @returns {string[]}
 */
function caseProblems(section, c, keys, where) {
  const f = fields(c, where);
  if (section === "relativeTime") return relativeProblems(c, keys, where);
  if (section === "initials") {
    const named = c?.name === null || typeof c?.name === "string";
    return [
      ...(named ? [] : [`${where}: name is neither a string nor null`]),
      ...f.text("initials"),
    ];
  }
  if (section === "notice") return noticeProblems(c, keys, where);
  if (section === "problem") {
    const outcome = c?.outcome === "unreachable" || c?.outcome === "refused";
    return [
      ...(outcome ? [] : [`${where}: outcome is neither unreachable nor refused`]),
      ...f.key(keys),
    ];
  }
  return [...f.instant("at"), ...f.instant("now"), ...f.text("expected")];
}

/**
 * @param {any} vectors the parsed api/presentation.vectors.json
 * @param {any} contract the parsed brand/strings.contract.json
 * @returns {string[]} what is wrong, empty when the vectors are sound
 */
export function check(vectors, contract) {
  const keys = contract?.keys ?? {};
  if (Object.keys(keys).length === 0) return ["brand/strings.contract.json has no keys"];
  /** @type {string[]} */
  const problems = [];
  if (typeof vectors?.zone !== "string") problems.push('presentation.vectors.json has no "zone"');
  for (const section of SECTIONS) {
    const cases = vectors?.[section];
    if (!Array.isArray(cases) || cases.length === 0) {
      problems.push(`presentation.vectors.json has no "${section}" cases`);
      continue;
    }
    for (const [index, c] of cases.entries()) {
      problems.push(
        ...caseProblems(section, c, keys, `presentation.vectors.json ${section}[${index}]`),
      );
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = check(
    readJson("api/presentation.vectors.json"),
    readJson("brand/strings.contract.json"),
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`❌ ${problem}`);
    process.exit(1);
  }
  console.log("✓ api/presentation.vectors.json names only keys of the strings contract");
}
