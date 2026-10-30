// @ts-check
// The term table (decision 0117): the words the UI uses for a product's nouns, in one file per
// brand, brand/<name>/terms.is.json. A string writes `[[group.acc]]`; generation replaces the
// token, so every generated file holds plain text and no client or runtime knows the table.
//
//   [[group.acc]]        the slot `acc` of the term `group`, as written in the table
//   [[Group.nom.pl]]     the same, its first letter capitalised, to open a sentence
//
// A slot is either a form of the noun (`nom`, `acc`, `dat`, `gen`, then `.pl`, then `.def`) or an
// agreement word the strings need because the noun has a gender (`it.acc`, `this.nom`, `open.nom`).
// The grammar sits next to `{name}` placeholders and does not collide with them.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { readJson } from "../repo.mjs";

/**
 * @typedef {{ forms: Record<string, string>, agreement?: Record<string, string>, variants?: Record<string, string> }} Term
 * @typedef {{ terms: Record<string, Term>, compounds?: Array<{ word: string, reason: string }>, retired?: Array<{ headword: string, guid: string, forms: string[] }> }} TermTable
 */

const TOKEN_SOURCE = String.raw`\[\[([A-Za-z_]+)\.([a-z]+(?:\.[a-z]+)*)\]\]`;

/** @param {string} text */
const tokens = (text) => text.matchAll(new RegExp(TOKEN_SOURCE, "g"));

/**
 * The brand's table, or an empty one: a brand needs none until a string writes a token.
 *
 * @param {string} dir repo-relative brand directory
 * @param {string} root
 * @returns {TermTable}
 */
export function readTerms(dir, root) {
  const file = `${dir}/terms.is.json`;
  return existsSync(join(root, file)) ? readJson(file, root) : { terms: {} };
}

/**
 * @param {string} id the term id as written in a token, capitalised or not
 * @returns {string}
 */
function termId(id) {
  return id.charAt(0).toLowerCase() + id.slice(1);
}

/** @param {Term | undefined} term */
function slots(term) {
  return { ...term?.agreement, ...term?.forms };
}

/**
 * @param {string} text
 * @param {TermTable} table
 * @returns {string}
 */
export function expandText(text, table) {
  return text.replace(new RegExp(TOKEN_SOURCE, "g"), (_, /** @type {string} */ id, slot) => {
    const word = slots(table.terms[termId(id)])[slot];
    if (word === undefined) throw new Error(`no such token: ${id}.${slot}`);
    return id === termId(id) ? word : word.charAt(0).toUpperCase() + word.slice(1);
  });
}

/**
 * Every value of a parsed strings file with its tokens replaced; `$` keys are notes to a person.
 *
 * @param {Record<string, any>} strings
 * @param {TermTable} table
 * @returns {Record<string, any>}
 */
export function expandStrings(strings, table) {
  return Object.fromEntries(
    Object.entries(strings).map(([key, value]) => {
      if (key.startsWith("$")) return [key, value];
      if (typeof value === "string") return [key, expandText(value, table)];
      return [key, expandStrings(value, table)];
    }),
  );
}

/**
 * @param {string} text generated text
 * @returns {string[]} the tokens in it
 */
export function tokensIn(text) {
  return [...tokens(text)].map((m) => m[0]);
}

/**
 * @param {Record<string, any>} strings
 * @returns {Array<[string, string]>} label and text of every string value
 */
function texts(strings) {
  return Object.entries(strings)
    .filter(([key]) => !key.startsWith("$"))
    .flatMap(([key, value]) =>
      typeof value === "string"
        ? [/** @type {[string, string]} */ ([key, value])]
        : Object.entries(value ?? {}).map(
            ([category, text]) => /** @type {[string, string]} */ ([`${key}.${category}`, text]),
          ),
    );
}

/**
 * The noun's spellings to look for in a raw string, longest first across terms so a word is
 * attributed to the longest noun inside it.
 *
 * @param {TermTable} table
 * @returns {Array<{ form: string, problem: string }>}
 */
function bannedForms(table) {
  const nouns = Object.entries(table.terms).flatMap(([id, term]) =>
    [...Object.values(term.forms), ...Object.values(term.variants ?? {})].map((form) => ({
      form: form.toLowerCase(),
      problem: `carries the noun of term "${id}": write a token, or declare the compound`,
    })),
  );
  const retired = (table.retired ?? []).flatMap(({ headword, guid, forms }) =>
    forms.map((form) => ({
      form: form.toLowerCase(),
      problem: `is a form of retired "${headword}" (BÍN ${guid})`,
    })),
  );
  return [...nouns, ...retired].sort((a, b) => b.form.length - a.form.length);
}

/**
 * Every token resolves, and no string writes a term's noun or a retired word by hand.
 *
 * @param {TermTable} table
 * @param {Record<string, any>} strings parsed strings.is.json
 * @returns {string[]}
 */
export function checkTerms(table, strings) {
  /** @type {string[]} */
  const problems = [];
  const banned = bannedForms(table);
  const compounds = new Set((table.compounds ?? []).map((c) => c.word.toLowerCase()));
  const used = new Set();
  for (const [label, text] of texts(strings)) {
    for (const [, id = "", slot = ""] of tokens(text)) {
      const term = table.terms[termId(id)];
      if (!term) problems.push(`${label}: unknown term "${id}"`);
      else if (!(slot in slots(term)))
        problems.push(`${label}: term "${id}" has no slot "${slot}"`);
    }
    const raw = text.replace(new RegExp(TOKEN_SOURCE, "g"), " ").replace(/\{[^}]*\}/g, " ");
    if (raw.includes("[[") || raw.includes("]]")) problems.push(`${label}: malformed token`);
    for (const [word] of raw.matchAll(/\p{L}+/gu)) {
      const lower = word.toLowerCase();
      if (compounds.has(lower)) {
        used.add(lower);
        continue;
      }
      const hit = banned.find(({ form }) => lower.includes(form));
      if (hit) problems.push(`${label}: "${word}" ${hit.problem}`);
    }
  }
  for (const word of compounds)
    if (!used.has(word)) problems.push(`terms.is.json compound "${word}" is in no string`);
  return problems;
}

/**
 * @param {Array<{ path: string, content: string | Buffer }>} files
 * @returns {string[]}
 */
export function tokensInOutputs(files) {
  return files.flatMap(({ path, content }) =>
    typeof content === "string"
      ? tokensIn(content).map((token) => `a token reached ${path}: ${token}`)
      : [],
  );
}
