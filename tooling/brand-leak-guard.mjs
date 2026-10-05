// @ts-check
// Brand leak guard (docs/decisions/0004).
//
// A rename must be a change under brand/<name>/ and nothing else. That holds
// only while the brand name appears nowhere outside its own directory: not in
// a frozen identifier, not in a Kotlin class, not in a Swift string, not in a
// backend message. This guard enforces both halves:
//
//   1. no value in identifiers/ids.json contains any brand's stem, as a
//      substring (ids are compounds: `<stem>api` must fail as surely as `<stem>`);
//   2. no visible file outside brand/<name>/ and that brand's allowPaths
//      contains a word starting with one of its stems.
//
// Word matching is the only workable rule for a name that is also an ordinary
// noun and inflects, so every case form, the verb made from it and its
// umlauted stem must all count. camelCase is split first so `<Stem>Theme` is
// caught. Words that share a stem but are other words (a person's name) are
// listed in allowPrefixes with a reason.

import { matchesGlob } from "node:path";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brandNames, jsonStrings, readJson, ROOT, visibleFiles } from "./lib/repo.mjs";

/**
 * @typedef {{ stems: string[], allowPrefixes: string[], allowPaths: string[] }} LeakTerms
 * @typedef {{ name: string, leakTerms: LeakTerms }} Brand
 * @typedef {{ file: string, line: number, word: string, brand: string }} Leak
 */

const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|zip|jar|keystore|p8|p12)$/i;
const SKIPPED = [/(^|\/)pnpm-lock\.yaml$/, /(^|\/)node_modules\//];

/**
 * Words of a text, lowercased, with camelCase and PascalCase split apart.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function words(text) {
  const split = text
    .replace(/(\p{Ll})(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, "$1 $2");
  return (split.match(/\p{L}+/gu) ?? []).map((w) => w.toLocaleLowerCase("is"));
}

/**
 * @param {string} word lowercase
 * @param {LeakTerms} terms
 */
export function isLeakWord(word, terms) {
  if (!terms.stems.some((stem) => word.startsWith(stem))) return false;
  return !terms.allowPrefixes.some((prefix) => word.startsWith(prefix));
}

/**
 * @param {string} text
 * @param {LeakTerms} terms
 * @returns {Array<{ line: number, word: string }>}
 */
export function leaksInText(text, terms) {
  /** @type {Array<{ line: number, word: string }>} */
  const found = [];
  text.split("\n").forEach((line, i) => {
    for (const word of words(line)) if (isLeakWord(word, terms)) found.push({ line: i + 1, word });
  });
  return found;
}

/**
 * Frozen ids are checked as substrings, not words: an identifier is a
 * compound and a stem buried inside one is still the brand in a frozen place.
 *
 * @param {unknown} ids parsed identifiers/ids.json
 * @param {Brand[]} brands
 * @returns {string[]}
 */
export function leaksInIds(ids, brands) {
  /** @type {string[]} */
  const problems = [];
  for (const { pointer, text } of jsonStrings(ids)) {
    const lower = text.toLocaleLowerCase("is");
    for (const brand of brands) {
      const stem = brand.leakTerms.stems.find((s) => lower.includes(s));
      if (stem)
        problems.push(
          `identifiers/ids.json ${pointer} "${text}" contains "${stem}" (brand ${brand.name})`,
        );
    }
  }
  return problems;
}

/**
 * @param {string} file
 * @param {Brand} brand
 */
function exempt(file, brand) {
  if (file.startsWith(`brand/${brand.name}/`)) return true;
  return brand.leakTerms.allowPaths.some((glob) => matchesGlob(file, glob));
}

/**
 * @param {string[]} files repo-relative
 * @param {Brand[]} brands
 * @param {string} [root]
 * @returns {Leak[]}
 */
export function leaksInFiles(files, brands, root = ROOT) {
  /** @type {Leak[]} */
  const leaks = [];
  for (const file of files) {
    if (BINARY.test(file) || SKIPPED.some((re) => re.test(file))) continue;
    const path = join(root, file);
    if (statSync(path).size > 2 * 1024 * 1024) continue;
    const text = readFileSync(path, "utf8");
    if (text.includes("\0")) continue;
    for (const brand of brands) {
      if (exempt(file, brand)) continue;
      for (const { line, word } of leaksInText(text, brand.leakTerms)) {
        leaks.push({ file, line, word, brand: brand.name });
      }
    }
  }
  return leaks;
}

/**
 * @param {string} [root]
 * @returns {Brand[]}
 */
export function loadBrands(root = ROOT) {
  return brandNames(root).map((name) => readJson(`brand/${name}/brand.json`, root));
}

function main() {
  const brands = loadBrands();
  if (brands.length === 0) {
    console.error("✗ no brand found under brand/: nothing was checked");
    process.exit(1);
  }
  const files = visibleFiles();
  const idProblems = leaksInIds(readJson("identifiers/ids.json"), brands);
  const leaks = leaksInFiles(files, brands);
  for (const p of idProblems) console.error(`::error file=identifiers/ids.json::${p}`);
  for (const l of leaks) {
    console.error(
      `::error file=${l.file},line=${l.line}::"${l.word}" names brand ${l.brand} outside brand/${l.brand}/`,
    );
  }
  if (idProblems.length + leaks.length > 0) {
    console.error(`
The brand name lives only in brand/<name>/. Code refers to a strings key or a
token; a frozen id is neutral (docs/decisions/0004). If the word is not the
brand (a person's name, another noun), add its prefix to leakTerms.allowPrefixes
in brand/<name>/brand.json with the reason.`);
    process.exit(1);
  }
  console.log(
    `✓ no brand name outside brand/ in ${files.length} file(s); frozen ids neutral (${brands.map((b) => b.name).join(", ")})`,
  );
}

if (import.meta.main) main();
