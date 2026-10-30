// @ts-check
// A term's forms for brand/<name>/terms.is.json (decision 0117), fetched from BÍN and never typed.
//
//   node tooling/terms-forms.mjs <headword>                     a noun BÍN has
//   node tooling/terms-forms.mjs samtal --prefix hóp            a compound BÍN has no headword for
//   node tooling/terms-forms.mjs hópur --prefer dat             take BÍN's second spelling of a slot
//
// Prints the term's JSON. Exit 3 when BÍN did not answer or has no such noun, and nothing is
// printed: a partial list silently narrows the gate.

const API = "https://bin.arnastofnun.is/api/ord/";
const CASES = { NF: "nom", ÞF: "acc", ÞGF: "dat", EF: "gen" };
const TAG = /^(NF|ÞF|ÞGF|EF)(ET|FT)(gr)?(\d)?$/;

/**
 * @param {string} tag BÍN's grammatical tag
 * @returns {{ slot: string, second: boolean } | null}
 */
function slotOf(tag) {
  const match = TAG.exec(tag);
  if (!match) return null;
  const grammaticalCase = CASES[/** @type {keyof typeof CASES} */ (match[1])];
  const slot = [grammaticalCase, match[2] === "FT" && "pl", match[3] && "def"].filter(Boolean);
  return { slot: slot.join("."), second: Boolean(match[4]) };
}

/**
 * @param {any} entries BÍN's answer
 * @param {string} headword
 * @param {string} [prefix] the first part of a compound with no headword
 * @param {string[]} [prefer] slots that take BÍN's second spelling, the first becoming the variant
 * @returns {{ bin: { headword: string, guid: string, prefix?: string }, gender: string, forms: Record<string, string>, variants: Record<string, string> }}
 */
export function formsFrom(entries, headword, prefix = "", prefer = []) {
  const entry = (Array.isArray(entries) ? entries : []).find(
    (e) => e.ord === headword && e.ofl === "no",
  );
  if (!entry) throw new Error(`BÍN has no noun "${headword}"`);
  /** @type {Record<string, string>} */
  const forms = {};
  /** @type {Record<string, string>} */
  const variants = {};
  for (const { g, b } of entry.bmyndir) {
    const found = slotOf(g);
    if (!found) continue;
    const swap = prefer.includes(found.slot);
    (found.second === swap ? forms : variants)[found.slot] = `${prefix}${b}`;
  }
  return {
    bin: { headword, guid: entry.guid, ...(prefix ? { prefix } : {}) },
    gender: entry.kyn,
    forms,
    variants,
  };
}

/** @param {string} flag */
function argAfter(flag) {
  const at = process.argv.indexOf(flag);
  return at === -1 ? undefined : process.argv[at + 1];
}

async function main() {
  const headword = process.argv[2];
  if (!headword) {
    console.error(
      "usage: node tooling/terms-forms.mjs <headword> [--prefix <part>] [--prefer <slot>]",
    );
    process.exit(2);
  }
  const prefer = argAfter("--prefer");
  try {
    const response = await fetch(`${API}${encodeURIComponent(headword)}`);
    if (!response.ok) throw new Error(`BÍN answered ${response.status}`);
    const term = formsFrom(
      await response.json(),
      headword,
      argAfter("--prefix"),
      prefer ? [prefer] : [],
    );
    console.log(JSON.stringify(term, null, 2));
  } catch (error) {
    console.error(`✗ ${/** @type {Error} */ (error).message}`);
    process.exit(3);
  }
}

if (import.meta.main) await main();
