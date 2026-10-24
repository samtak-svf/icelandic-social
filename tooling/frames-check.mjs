// @ts-check
// The image frame sizes the API documents and the shared vectors agree
// (decision 0086).
//
// `api/openapi.json` carries FRAME_SPECS as `x-frame-specs`, generated from
// the Worker's own table. `api/frames.vectors.json` is what every client
// checks its placement code against: each placement case uses the aspect
// ratio of a documented frame, and every expected rectangle lies inside its
// image. A vector for a ratio the API no longer documents, or a documented
// size that is not whole pixels, fails here before a client cuts a wrong crop.
//
//   node tooling/frames-check.mjs

import { readJson } from "./lib/repo.mjs";

/**
 * @typedef {{ w: number, h: number }} Size
 * @typedef {Record<string, Record<string, Size>>} Specs
 */

/**
 * @param {any} specs x-frame-specs
 * @returns {string[]}
 */
function specProblems(specs) {
  /** @type {string[]} */
  const problems = [];
  for (const [kind, frames] of Object.entries(/** @type {Specs} */ (specs))) {
    if (Object.keys(frames ?? {}).length === 0)
      problems.push(`x-frame-specs.${kind} names no frame`);
    for (const [name, size] of Object.entries(frames ?? {})) {
      const whole =
        Number.isInteger(size?.w) && Number.isInteger(size?.h) && size.w > 0 && size.h > 0;
      if (!whole) problems.push(`x-frame-specs.${kind}.${name} is not a whole pixel size`);
    }
  }
  return problems;
}

/**
 * @param {any} c one vector case
 * @param {string} group "place" or "override"
 * @param {Specs} specs
 * @param {string} where
 * @returns {string[]}
 */
function caseProblems(c, group, specs, where) {
  const expected = c?.expected;
  if (!expected) return [`${where}: no expected rectangle`];
  /** @type {string[]} */
  const problems = [];
  const sizes = Object.values(specs).flatMap((frames) => Object.values(frames));
  if (group === "place" && !sizes.some((s) => s.w * c.aspectH === s.h * c.aspectW)) {
    problems.push(
      `${where}: aspect ${c.aspectW}:${c.aspectH} is the ratio of no frame in x-frame-specs`,
    );
  }
  const inside =
    expected.x >= 0 &&
    expected.y >= 0 &&
    expected.x + expected.w <= c.imageW &&
    expected.y + expected.h <= c.imageH;
  if (!inside) problems.push(`${where}: the expected rectangle leaves the image`);
  return problems;
}

/**
 * @param {any} openapi the parsed api/openapi.json
 * @param {any} vectors the parsed api/frames.vectors.json
 * @returns {string[]} what is wrong, empty when the two agree
 */
export function check(openapi, vectors) {
  const specs = openapi?.["x-frame-specs"];
  if (!specs || typeof specs !== "object" || Object.keys(specs).length === 0) {
    return ["api/openapi.json has no x-frame-specs"];
  }
  const problems = specProblems(specs);
  for (const group of /** @type {const} */ (["place", "override"])) {
    const cases = vectors?.[group];
    if (!Array.isArray(cases) || cases.length === 0) {
      problems.push(`frames.vectors.json has no "${group}" cases`);
      continue;
    }
    for (const [index, c] of cases.entries()) {
      const where = `frames.vectors.json ${group}[${index}] (${c?.name ?? "unnamed"})`;
      problems.push(...caseProblems(c, group, specs, where));
    }
  }
  return problems;
}

if (import.meta.main) {
  const problems = check(readJson("api/openapi.json"), readJson("api/frames.vectors.json"));
  if (problems.length > 0) {
    for (const problem of problems) console.error(`❌ ${problem}`);
    process.exit(1);
  }
  console.log("✓ the frame sizes in api/openapi.json and api/frames.vectors.json agree");
}
