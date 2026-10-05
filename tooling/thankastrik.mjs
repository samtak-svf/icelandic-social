// @ts-check
// No þankastrik in the app's Icelandic text.
//
// Ported from samtak-vefur scripts/lib/thankastrik-audit.mjs (#438, #440).
// The rule is a house STYLE choice, not an orthography correction: Ritreglur
// (auglýsing nr. 695/2016, ritreglur.arnastofnun.is) ch. 26 "Strik og bönd"
// treats the þankastrik as an ordinary mark (§ 26.3), allows it in headings
// (§ 26.2.2) and records the short spaced form (§ 26.2.3). Guðröður's house
// style drops it in both lengths in favour of a comma, a full stop or a
// rephrase. Details and the reasoning: the `icelandic` skill.
//
// The discriminator between a banned þankastrik and a legitimate millistrik
// is SPACING (§ 26.2.1): none around a millistrik (`2022–2024`, a route), a
// space on both sides of a þankastrik. So: any em dash, and a spaced en dash.
//
// Scope here is every string value in the brand JSON (strings.is.json is the
// whole of the app's copy; brand.json carries store-facing values) and, when
// they exist, the generated string resources. A string counts as Icelandic
// when it has a letter English lacks; an English `$description` is left alone.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jsonStrings, ROOT, visibleFiles } from "./lib/repo.mjs";

/** The two banned shapes. `\s` covers the no-break space. */
const THANKASTRIK = [
  { kind: "langt þankastrik (—)", pattern: /—|&mdash;/ },
  { kind: "stutt þankastrik (spaced –)", pattern: /(?:\s|&nbsp;)(?:–|&ndash;)(?:\s|&nbsp;)/ },
];

/** Letters Icelandic has and English does not: the mark of Icelandic prose. */
const ICELANDIC_LETTER = /[áéíóúýþæöðÁÉÍÓÚÝÞÆÖÐ]/;

/** Files whose strings reach a reader as Icelandic. */
const SCANNED = /^brand\/[^/]+\/[^/]+\.json$/;

/**
 * @param {string} text
 * @returns {string[]} the kinds of þankastrik in an Icelandic string
 */
export function thankastrikIn(text) {
  if (!ICELANDIC_LETTER.test(text)) return [];
  return THANKASTRIK.filter(({ pattern }) => pattern.test(text)).map(({ kind }) => kind);
}

/**
 * @param {string[]} files repo-relative
 * @param {string} [root]
 * @returns {{ problems: Array<{ file: string, pointer: string, kind: string, context: string }>, scanned: number }}
 */
export function auditThankastrik(files, root = ROOT) {
  const targets = files.filter((f) => SCANNED.test(f));
  /** @type {Array<{ file: string, pointer: string, kind: string, context: string }>} */
  const problems = [];
  for (const file of targets) {
    const json = JSON.parse(readFileSync(join(root, file), "utf8"));
    for (const { pointer, text } of jsonStrings(json)) {
      for (const kind of thankastrikIn(text)) {
        problems.push({ file, pointer, kind, context: text.slice(0, 140) });
      }
    }
  }
  return { problems, scanned: targets.length };
}

function main() {
  const { problems, scanned } = auditThankastrik(visibleFiles());
  if (scanned === 0) {
    console.error("✗ no brand JSON found: nothing was checked");
    process.exit(1);
  }
  if (problems.length === 0) {
    console.log(`✓ no þankastrik in ${scanned} brand file(s)`);
    return;
  }
  for (const p of problems)
    console.error(`::error file=${p.file}::${p.kind} at ${p.pointer}: ${p.context}`);
  console.error(`
${problems.length} þankastrik in Icelandic text. House style drops it in both
lengths. Use a comma, a full stop, a colon, or rephrase. An unspaced en dash
(2022–2024) is a millistrik and is fine.`);
  process.exit(1);
}

if (import.meta.main) main();
