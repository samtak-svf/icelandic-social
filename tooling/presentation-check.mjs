// @ts-check
// The shared presentation vectors are well formed (#275).
//
// `api/presentation.vectors.json` is what the web, Android and iOS tests read
// to prove that relative time, initials, row stamps and problem text agree.
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
]);

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
