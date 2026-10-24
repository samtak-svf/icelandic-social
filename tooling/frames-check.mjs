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
// The Rust core keeps the same sizes as constants in core/client/src/frames.rs
// (COVER_COMPACT, PHOTO_SQUARE, ...), one `FrameSize { w: N, h: N }` per line;
// they must equal x-frame-specs exactly, with none missing and none extra.
//
// `x-size-classes` is where the medium and expanded window size classes begin
// (decisions 0086, 0087). The core keeps them as MEDIUM_FROM and EXPANDED_FROM,
// which must equal the contract; the web generates its breakpoints from it,
// and the apps ask the core. So no client source may type one of the widths
// as a breakpoint itself: a media query, a Tailwind `min-[…]` variant, a width
// compared with it, or a constant set to it are refused under CLIENT_ROOTS.
//
//   node tooling/frames-check.mjs

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { ROOT, readJson } from "./lib/repo.mjs";

/** Where the Rust core keeps its copy of the frame sizes. */
export const RUST_FRAMES = "core/client/src/frames.rs";

/** The client sources that must take their breakpoints from the contract or the core. */
export const CLIENT_ROOTS = ["web/src", "ios/App", "android/app/src/main"];

/** Generated files, which carry the contract's widths by design, and tests, which feed widths in. */
const NOT_SCANNED = /(^|\/)generated\/|\.test\.tsx?$/;

const SOURCE = /\.(ts|tsx|css|swift|kt)$/;

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
 * The frame-size constants of the Rust source, as `{ cover: { compact: Size } }`.
 * @param {string} source the text of core/client/src/frames.rs
 * @returns {Specs}
 */
export function rustSpecs(source) {
  /** @type {Specs} */
  const specs = {};
  const line =
    /^\s*pub const (COVER|PHOTO)_([A-Z]+): FrameSize = FrameSize \{ w: (\d+), h: (\d+) \};/gm;
  for (const [, kind = "", name = "", w, h] of source.matchAll(line)) {
    (specs[kind.toLowerCase()] ??= {})[name.toLowerCase()] = { w: Number(w), h: Number(h) };
  }
  return specs;
}

/**
 * @param {any} specs x-frame-specs
 * @param {string} source the text of core/client/src/frames.rs
 * @returns {string[]}
 */
function rustProblems(specs, source) {
  const rust = rustSpecs(source);
  if (Object.keys(rust).length === 0) return [`${RUST_FRAMES} has no frame-size constants`];
  /** @type {string[]} */
  const problems = [];
  for (const kind of new Set([...Object.keys(specs), ...Object.keys(rust)])) {
    for (const name of new Set([
      ...Object.keys(specs[kind] ?? {}),
      ...Object.keys(rust[kind] ?? {}),
    ])) {
      const want = specs[kind]?.[name];
      const have = rust[kind]?.[name];
      if (!want) problems.push(`${RUST_FRAMES} has ${kind}.${name}, x-frame-specs does not`);
      else if (!have) problems.push(`${RUST_FRAMES} lacks ${kind}.${name} of x-frame-specs`);
      else if (want.w !== have.w || want.h !== have.h)
        problems.push(
          `${RUST_FRAMES} ${kind}.${name} is ${have.w}x${have.h}, x-frame-specs says ${want.w}x${want.h}`,
        );
    }
  }
  return problems;
}

/**
 * @param {any} classes x-size-classes
 * @returns {string[]}
 */
function sizeClassProblems(classes) {
  if (!classes || typeof classes !== "object") return ["api/openapi.json has no x-size-classes"];
  const { medium, expanded } = classes;
  if (
    !Number.isInteger(medium) ||
    !Number.isInteger(expanded) ||
    !(0 < medium && medium < expanded)
  )
    return [
      `x-size-classes needs whole widths with 0 < medium < expanded, not ${JSON.stringify(classes)}`,
    ];
  return [];
}

/**
 * The core's size-class constants against the contract's.
 * @param {{ medium: number, expanded: number }} classes x-size-classes
 * @param {string} source the text of core/client/src/frames.rs
 * @returns {string[]}
 */
function rustClassProblems(classes, source) {
  /** @type {string[]} */
  const problems = [];
  for (const [name, key] of /** @type {const} */ ([
    ["MEDIUM_FROM", "medium"],
    ["EXPANDED_FROM", "expanded"],
  ])) {
    const found = new RegExp(`^\\s*pub const ${name}: u32 = (\\d+);`, "m").exec(source);
    if (!found) problems.push(`${RUST_FRAMES} lacks ${name}`);
    else if (Number(found[1]) !== classes[key])
      problems.push(`${RUST_FRAMES} ${name} is ${found[1]}, x-size-classes says ${classes[key]}`);
  }
  return problems;
}

/**
 * Where a client source types a size-class width as a breakpoint: a media
 * query, a Tailwind arbitrary variant, a width compared with it, or a
 * constant whose name says it is a width set to it. Comments are skipped.
 *
 * @param {{ path: string, text: string }[]} files
 * @param {{ medium: number, expanded: number }} classes x-size-classes
 * @returns {string[]}
 */
export function handTypedBreakpoints(files, classes) {
  const widths = [classes.medium, classes.expanded].join("|");
  const patterns = [
    new RegExp(`\\b(?:min|max)-\\[(?:${widths})(?:px)?\\]`),
    new RegExp(`\\b(?:min|max)-width:\\s*(?:${widths})(?:px)?\\b`),
    new RegExp(`(?:width|Width|Dp|dp)\\b[^\\n]{0,24}?(?:>=|<=|<|>)\\s*(?:${widths})(?:\\.0)?\\b`),
    new RegExp(
      `\\b[A-Z_]*(?:DP|WIDTH|BREAKPOINT|FROM)[A-Z_]*\\s*(?::\\s*\\w+\\s*)?=\\s*(?:${widths})\\b`,
    ),
  ];
  /** @type {string[]} */
  const problems = [];
  for (const { path, text } of files) {
    for (const [index, line] of text.split("\n").entries()) {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) continue;
      if (patterns.some((p) => p.test(line)))
        problems.push(`${path}:${index + 1} types a size-class width by hand: ${line.trim()}`);
    }
  }
  return problems;
}

/**
 * The client sources under CLIENT_ROOTS, as the scan reads them.
 * @returns {{ path: string, text: string }[]}
 */
export function clientSources() {
  /** @type {{ path: string, text: string }[]} */
  const files = [];
  for (const root of CLIENT_ROOTS) {
    for (const entry of readdirSync(join(ROOT, root), { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !SOURCE.test(entry.name)) continue;
      const full = join(entry.parentPath, entry.name);
      const path = relative(ROOT, full);
      if (!NOT_SCANNED.test(path)) files.push({ path, text: readFileSync(full, "utf8") });
    }
  }
  return files;
}

/**
 * The size classes, then the core and the clients against them; the last two
 * only when the classes themselves are sound.
 * @param {any} classes x-size-classes
 * @param {string} [rustSource] the text of core/client/src/frames.rs
 * @param {{ path: string, text: string }[]} [clients] client sources
 * @returns {string[]}
 */
function classesProblems(classes, rustSource, clients) {
  const problems = sizeClassProblems(classes);
  if (problems.length > 0) return problems;
  if (rustSource !== undefined) problems.push(...rustClassProblems(classes, rustSource));
  if (clients !== undefined) {
    if (clients.length === 0) problems.push("no client source was found to scan for breakpoints");
    problems.push(...handTypedBreakpoints(clients, classes));
  }
  return problems;
}

/**
 * @param {any} openapi the parsed api/openapi.json
 * @param {any} vectors the parsed api/frames.vectors.json
 * @param {string} [rustSource] the text of core/client/src/frames.rs, when it is to be held to the specs
 * @param {{ path: string, text: string }[]} [clients] client sources, when they are to be scanned
 * @returns {string[]} what is wrong, empty when they agree
 */
export function check(openapi, vectors, rustSource, clients) {
  const specs = openapi?.["x-frame-specs"];
  if (!specs || typeof specs !== "object" || Object.keys(specs).length === 0) {
    return ["api/openapi.json has no x-frame-specs"];
  }
  const problems = specProblems(specs);
  if (rustSource !== undefined) problems.push(...rustProblems(specs, rustSource));
  problems.push(...classesProblems(openapi["x-size-classes"], rustSource, clients));
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
  const problems = check(
    readJson("api/openapi.json"),
    readJson("api/frames.vectors.json"),
    readFileSync(join(ROOT, RUST_FRAMES), "utf8"),
    clientSources(),
  );
  if (problems.length > 0) {
    for (const problem of problems) console.error(`❌ ${problem}`);
    process.exit(1);
  }
  console.log(
    "✓ the frame sizes and size classes in api/openapi.json, api/frames.vectors.json, the Rust core and the clients agree",
  );
}
