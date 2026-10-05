// @ts-check
// Brand check: every brand under brand/ is complete, consistent and readable.
//
//   - brand.json validates against brand/brand.schema.json, and its name is
//     its directory;
//   - strings.is.json has EXACTLY the keys of brand/strings.contract.json, no
//     more and no fewer, because code references keys and a missing key is a
//     crash on one platform and a raw key on screen on the other;
//   - each value has the declared placeholders, no more and no fewer, and a
//     plural key carries the Icelandic CLDR categories `one` and `other`;
//   - a claim the brand makes is worded exactly as decided (CLAIMS below);
//   - every colour pair in brand/contrast-pairs.json meets its WCAG threshold;
//   - the icon's foreground SVG exists and its background token is opaque.
//
// tooling/brand-gen.mjs refuses to generate from a brand this check rejects.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { colorTokens, measure, resolveColor, THRESHOLDS } from "./lib/contrast.mjs";
import { brandNames, readJson, ROOT } from "./lib/repo.mjs";
import { validate } from "./lib/schema.mjs";

/**
 * Exact wording for each factual claim, as decided. A brand that sets the
 * claim must carry this phrase in every string keyed to it; rewording it is a
 * decision record, not copy-editing.
 */
export const CLAIMS = {
  // docs/decisions/0001: storage is EU-jurisdiction, processing is on
  // Cloudflare's global network. Never "á Íslandi", never "unnin innan ESB".
  residency: "geymd varanlega innan ESB; unnin á netkerfi Cloudflare",
};

/** Icelandic CLDR plural categories (unicode.org/cldr, plurals.xml). */
const PLURAL_CATEGORIES = ["one", "other"];

const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;

/**
 * @typedef {{ surfaces: string[], description: string, placeholders?: Record<string, string>, plural?: boolean, claim?: keyof typeof CLAIMS }} ContractKey
 * @typedef {{ keys: Record<string, ContractKey> }} Contract
 */

/** @param {string} text */
function placeholdersIn(text) {
  return new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] ?? ""));
}

/**
 * @param {Set<string>} actual
 * @param {Set<string>} expected
 */
function sameSet(actual, expected) {
  return actual.size === expected.size && [...actual].every((x) => expected.has(x));
}

/**
 * @param {string} key
 * @param {ContractKey} spec
 * @param {unknown} value
 * @returns {string[]}
 */
function checkValue(key, spec, value) {
  const expected = new Set(Object.keys(spec.placeholders ?? {}));
  /** @type {Array<[string, unknown]>} */
  let variants;
  if (spec.plural) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return [`${key}: plural key needs an object with ${PLURAL_CATEGORIES.join(", ")}`];
    }
    const categories = Object.keys(value).sort();
    if (categories.join() !== [...PLURAL_CATEGORIES].sort().join()) {
      return [`${key}: plural categories are [${categories}], expected [${PLURAL_CATEGORIES}]`];
    }
    variants = Object.entries(value).map(([c, v]) => [`${key}.${c}`, v]);
  } else {
    variants = [[key, value]];
  }
  /** @type {string[]} */
  const problems = [];
  for (const [label, text] of variants) {
    if (typeof text !== "string" || text.trim() === "") {
      problems.push(`${label}: must be a non-empty string`);
      continue;
    }
    const found = placeholdersIn(text);
    if (!sameSet(found, expected)) {
      problems.push(
        `${label}: placeholders {${[...found]}} but the contract declares {${[...expected]}}`,
      );
    }
  }
  return problems;
}

/**
 * @param {Contract} contract
 * @param {Record<string, unknown>} strings
 * @param {{ residency: boolean }} claims
 * @returns {string[]}
 */
export function checkStrings(contract, strings, claims) {
  /** @type {string[]} */
  const problems = [];
  const expected = Object.keys(contract.keys);
  const actual = Object.keys(strings).filter((k) => !k.startsWith("$"));
  for (const key of expected) if (!(key in strings)) problems.push(`${key}: missing`);
  for (const key of actual)
    if (!(key in contract.keys)) problems.push(`${key}: not in strings.contract.json`);
  for (const [key, spec] of Object.entries(contract.keys)) {
    if (!(key in strings)) continue;
    problems.push(...checkValue(key, spec, strings[key]));
    if (spec.claim && claims[spec.claim]) {
      const phrase = CLAIMS[spec.claim];
      if (!String(strings[key]).includes(phrase)) {
        problems.push(`${key}: the ${spec.claim} claim must contain exactly "${phrase}"`);
      }
    }
  }
  return problems;
}

/**
 * @param {Record<string, unknown>} tokens parsed tokens.json
 * @param {{ pairs: Array<{ fg: string, bg: string, level: keyof typeof THRESHOLDS, use: string }> }} pairs
 * @returns {{ problems: string[], rows: string[] }}
 */
export function checkContrast(tokens, pairs) {
  const map = colorTokens(tokens);
  /** @type {string[]} */
  const problems = [];
  /** @type {string[]} */
  const rows = [];
  for (const pair of pairs.pairs) {
    const threshold = THRESHOLDS[pair.level];
    if (!threshold) {
      problems.push(`${pair.fg} on ${pair.bg}: unknown level "${pair.level}"`);
      continue;
    }
    try {
      const { fg, bg, ratio } = measure(pair.fg, pair.bg, map);
      const ok = ratio >= threshold.min;
      rows.push(
        `${ok ? "✓" : "✗"} ${ratio.toFixed(2)}:1 ${pair.fg} on ${pair.bg} (${fg} on ${bg}, ${pair.use})`,
      );
      if (!ok)
        problems.push(
          `${pair.fg} on ${pair.bg}: ${ratio}:1 is below ${threshold.min}:1 (${threshold.label}, ${pair.use})`,
        );
    } catch (error) {
      problems.push(`${pair.fg} on ${pair.bg}: ${/** @type {Error} */ (error).message}`);
    }
  }
  return { problems, rows };
}

/**
 * @param {Record<string, any>} manifest parsed brand.json
 * @param {string} dirName
 * @param {Record<string, unknown>} strings
 * @returns {string[]}
 */
function checkManifest(manifest, dirName, strings) {
  /** @type {string[]} */
  const problems = [];
  if (manifest.name !== dirName)
    problems.push(`brand.json name "${manifest.name}" is not its directory "${dirName}"`);
  if (manifest.displayName !== strings.app_name) {
    problems.push(
      `brand.json displayName "${manifest.displayName}" differs from strings app_name "${String(strings.app_name)}"`,
    );
  }
  const reasons = manifest.leakTerms?.allowReasons ?? {};
  for (const prefix of manifest.leakTerms?.allowPrefixes ?? []) {
    if (!reasons[prefix])
      problems.push(`leakTerms.allowPrefixes "${prefix}" has no allowReasons entry`);
  }
  return problems;
}

/**
 * @param {{ foreground?: string, background?: string } | undefined} icon
 * @param {string} dir
 * @param {string} root
 * @param {any} tokens parsed tokens.json
 * @returns {string[]}
 */
function checkIcon(icon, dir, root, tokens) {
  if (!icon?.foreground || !icon.background) return [];
  /** @type {string[]} */
  const problems = [];
  if (!existsSync(join(root, dir, icon.foreground)))
    problems.push(`icon.foreground ${icon.foreground}: missing`);
  try {
    if (resolveColor(icon.background, colorTokens(tokens)).a < 255)
      problems.push(`icon.background "${icon.background}" is not opaque`);
  } catch (error) {
    problems.push(`icon.background: ${/** @type {Error} */ (error).message}`);
  }
  return problems;
}

/**
 * Checks one brand directory. Pure apart from reading files under `root`.
 *
 * @param {string} name
 * @param {string} [root]
 * @returns {{ problems: string[], rows: string[] }}
 */
export function checkBrand(name, root = ROOT) {
  const dir = `brand/${name}`;
  for (const file of ["brand.json", "strings.is.json", "tokens.json"]) {
    if (!existsSync(join(root, dir, file)))
      return { problems: [`${dir}/${file}: missing`], rows: [] };
  }
  const manifest = readJson(`${dir}/brand.json`, root);
  const strings = readJson(`${dir}/strings.is.json`, root);
  const problems = validate(readJson("brand/brand.schema.json", root), manifest).map(
    (p) => `brand.json ${p}`,
  );
  problems.push(...checkManifest(manifest, name, strings));
  problems.push(
    ...checkStrings(
      readJson("brand/strings.contract.json", root),
      strings,
      manifest.claims ?? {},
    ).map((p) => `strings.is.json ${p}`),
  );
  const tokens = readJson(`${dir}/tokens.json`, root);
  problems.push(...checkIcon(manifest.icon, dir, root, tokens));
  const contrast = checkContrast(tokens, readJson("brand/contrast-pairs.json", root));
  problems.push(...contrast.problems.map((p) => `contrast ${p}`));
  return { problems, rows: contrast.rows };
}

function main() {
  const verbose = process.argv.includes("--verbose");
  const names = brandNames();
  if (names.length === 0) {
    console.error("✗ no brand found under brand/: nothing was checked");
    process.exit(1);
  }
  let failed = 0;
  for (const name of names) {
    const { problems, rows } = checkBrand(name);
    if (verbose) for (const row of rows) console.log(`  ${row}`);
    if (problems.length === 0) {
      console.log(`✓ brand/${name}: manifest, ${rows.length} contrast pairs, strings complete`);
      continue;
    }
    failed += problems.length;
    for (const p of problems) console.error(`::error file=brand/${name}::${p}`);
  }
  if (failed > 0) {
    console.error(`\n${failed} brand problem(s). A brand that fails this check does not generate.`);
    process.exit(1);
  }
}

if (import.meta.main) main();
