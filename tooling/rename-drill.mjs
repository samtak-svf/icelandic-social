// @ts-check
// The rename drill (docs/decisions/0004): proof that a rename is a change
// under brand/<name>/ and nothing else.
//
//   node tooling/rename-drill.mjs prepare
//       write brand/_fixture/ (the active brand with its name replaced) and
//       generate the platform outputs from it, then run the leak guard with
//       _fixture active: no file outside brand/<old>/ may still carry the old
//       name;
//   node tooling/rename-drill.mjs scan <file>... [--absent <file>...]
//       after the apps and the Worker are built from _fixture, fail if any
//       built artifact (an APK, a bundle) carries a real brand's name, or
//       never carries the fixture's (a scan that sees nothing proves nothing).
//       Files after --absent ship no brand string yet, so only the first half
//       applies to them.
//
// _fixture is generated and never committed: CI runs `prepare` in its own
// checkout. Its name is chosen to be no word in any language the apps ship.

import { execFileSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { leaksInFiles, leaksInIds, leaksInText, loadBrands } from "./brand-leak-guard.mjs";
import { run } from "./brand-gen.mjs";
import { activeBrand } from "./lib/brand-gen/paths.mjs";
import { readJson, ROOT, visibleFiles } from "./lib/repo.mjs";

/**
 * @typedef {import("./brand-leak-guard.mjs").Brand} Brand
 * @typedef {import("./brand-leak-guard.mjs").LeakTerms} LeakTerms
 */

export const FIXTURE = "_fixture";
export const FIXTURE_NAME = "Zylox";

const TEXT = /\.(json|svg|xml|txt|md)$/i;

/**
 * Replaces every word that names the brand with the fixture's name, keeping
 * the case of its first letter. Inflection is lost, which a drill can afford.
 *
 * @param {string} text
 * @param {LeakTerms} terms
 */
export function renameIn(text, terms) {
  return text.replace(/\p{L}+/gu, (word) => {
    if (!leaksInText(word, terms).length) return word;
    const first = word.charAt(0);
    return first === first.toLocaleLowerCase("is")
      ? FIXTURE_NAME.toLocaleLowerCase("is")
      : FIXTURE_NAME;
  });
}

/**
 * Writes brand/_fixture/ from brand/<source>/: every text file with the name
 * replaced, binaries as they are, and a manifest naming the fixture.
 *
 * @param {string} source
 * @param {string} [root]
 */
export function writeFixture(source, root = ROOT) {
  /** @type {Brand} */
  const brand = readJson(`brand/${source}/brand.json`, root);
  const from = join(root, "brand", source);
  const to = join(root, "brand", FIXTURE);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  for (const entry of readdirSync(to, { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (!entry.isFile() || !TEXT.test(entry.name)) continue;
    writeFileSync(path, renameIn(readFileSync(path, "utf8"), brand.leakTerms));
  }
  const manifestPath = join(to, "brand.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.name = FIXTURE;
  manifest.displayName = FIXTURE_NAME;
  manifest.leakTerms = {
    stems: [FIXTURE_NAME.toLocaleLowerCase("is")],
    allowPrefixes: [],
    // The drill has to name its fixture.
    allowPaths: ["tooling/rename-drill.mjs", "tooling/tests/rename-drill.test.mjs"],
  };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Switches the tree to _fixture and lists what still names a real brand.
 *
 * @param {{ root?: string, files?: string[] }} [options]
 * @returns {string[]} problems; empty when the drill passes
 */
export function prepare({ root = ROOT, files } = {}) {
  const source = activeBrand(root);
  writeFixture(source, root);
  const { problems, stale } = run({ name: FIXTURE, check: false, root });
  if (problems.length > 0 || stale.length > 0) return [...problems, ...stale];
  const brands = loadBrands(root);
  return [
    ...leaksInIds(readJson("identifiers/ids.json", root), brands),
    ...leaksInFiles(files ?? visibleFiles(root), brands, root, FIXTURE).map(
      (l) => `${l.file}:${l.line} "${l.word}" names brand ${l.brand}`,
    ),
  ];
}

/**
 * The text an artifact can carry: each entry of a zip (APKs, AABs) or the
 * file itself, read as UTF-8 and as UTF-16LE, the two encodings Android
 * resources and binary XML store strings in.
 *
 * @param {string} file
 * @returns {Array<{ name: string, text: string }>}
 */
function textsOf(file) {
  /** @type {Array<{ name: string, data: Buffer }>} */
  let parts;
  if (/\.(apk|aab|zip)$/i.test(file)) {
    const entries = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
      .split("\n")
      .filter((name) => name && !name.endsWith("/"));
    parts = entries.map((name) => ({
      name: `${file}!${name}`,
      data: execFileSync("unzip", ["-p", file, name], { maxBuffer: 512 * 1024 * 1024 }),
    }));
  } else {
    parts = [{ name: file, data: readFileSync(file) }];
  }
  return parts.flatMap(({ name, data }) => [
    { name, text: data.toString("utf8") },
    { name: `${name} (utf-16)`, text: data.toString("utf16le") },
  ]);
}

/**
 * @param {string[]} artifacts paths of built outputs that show the brand
 * @param {Brand[]} brands every brand under brand/, the fixture included
 * @param {string[]} [absent] built outputs that ship no brand string
 * @returns {string[]} problems; empty when the drill passes
 */
export function scan(artifacts, brands, absent = []) {
  const fixture = brands.find((b) => b.name === FIXTURE);
  if (!fixture) return [`no brand/${FIXTURE}: run \`node tooling/rename-drill.mjs prepare\` first`];
  const real = brands.filter((b) => b.name !== FIXTURE);
  /** @type {string[]} */
  const problems = [];
  for (const artifact of [...artifacts, ...absent]) {
    if (!statSync(artifact, { throwIfNoEntry: false })?.isFile()) {
      problems.push(`${artifact}: no such file`);
      continue;
    }
    let seen = false;
    for (const { name, text } of textsOf(artifact)) {
      if (leaksInText(text, fixture.leakTerms).length > 0) seen = true;
      for (const brand of real) {
        for (const { word } of leaksInText(text, brand.leakTerms)) {
          problems.push(`${name}: "${word}" names brand ${brand.name}`);
        }
      }
    }
    if (!seen && !absent.includes(artifact))
      problems.push(`${artifact}: never names ${FIXTURE_NAME}, so it was not built from it`);
  }
  return problems;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  /** @type {string[]} */
  let problems;
  if (command === "prepare") problems = prepare();
  else if (command === "scan" && args.length > 0) {
    const split = args.includes("--absent") ? args.indexOf("--absent") : args.length;
    problems = scan(args.slice(0, split), loadBrands(), args.slice(split + 1));
  } else {
    console.error(
      "usage: node tooling/rename-drill.mjs prepare | scan <artifact>... [--absent <artifact>...]",
    );
    process.exit(2);
  }
  for (const p of problems) console.error(`::error::${p}`);
  if (problems.length > 0) {
    console.error(`\n❌ the rename drill failed: ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    command === "prepare"
      ? `✓ switched to brand/${FIXTURE}; no real brand's name left outside its directory`
      : `✓ the built artifacts name no real brand, and those that show one show ${FIXTURE_NAME}`,
  );
}

if (import.meta.main) main();
