// @ts-check
// A small scanner for JS/TS and JSONC source: it only has to know where
// strings and comments begin and end, not the grammar. Ported from
// samtak-vefur `tooling/seam-guard.mjs`, where matching identifiers with grep
// failed a seam on a log message that merely named the binding.
//
// Regex literals are not recognised; a binding name inside one would be a
// false positive, which has not happened in either repo.

/**
 * @typedef {{ text: string, next: number, kind: "comment" | "string" }} Span
 */

/**
 * Blank out comments and string literals, keeping offsets and newlines, so
 * whatever still matches is code and a reported line number is right.
 *
 * @param {string} source
 */
export function stripCommentsAndStrings(source) {
  return rewrite(source, (span) => blank(span.text));
}

/**
 * Remove comments from JSONC and drop trailing commas, keeping strings, so
 * `JSON.parse` accepts it (wrangler.jsonc).
 *
 * @param {string} source
 * @returns {any}
 */
export function parseJsonc(source) {
  const noComments = rewrite(source, (span) =>
    span.kind === "comment" ? blank(span.text) : span.text,
  );
  // A comma followed only by whitespace and a closing bracket is trailing.
  // Strings are masked with a non-space while looking, so `, "x"]` is not.
  const masked = rewrite(noComments, (span) => span.text.replace(/[^\n]/g, "_"));
  let out = "";
  for (let i = 0; i < noComments.length; i += 1) {
    if (masked[i] === "," && /^\s*[\]}]/.test(masked.slice(i + 1))) continue;
    out += noComments[i];
  }
  return JSON.parse(out);
}

/**
 * @param {string} source
 * @param {(span: Span) => string} replace
 */
function rewrite(source, replace) {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const span = spanAt(source, i);
    if (span) {
      out += replace(span);
      i = span.next;
      continue;
    }
    out += source[i];
    i += 1;
  }
  return out;
}

/**
 * @param {string} source
 * @param {number} i
 * @returns {Span | null}
 */
function spanAt(source, i) {
  const two = source.slice(i, i + 2);
  if (two === "//") return until(source, i, source.indexOf("\n", i), 0, "comment");
  if (two === "/*") return until(source, i, source.indexOf("*/", i + 2), 2, "comment");
  const c = source[i];
  if (c === '"' || c === "'" || c === "`") return stringAt(source, i, c);
  return null;
}

/**
 * @param {string} source
 * @param {number} start
 * @param {number} end index of the terminator, or -1 for end of input
 * @param {number} terminatorLength
 * @param {"comment" | "string"} kind
 * @returns {Span}
 */
function until(source, start, end, terminatorLength, kind) {
  const next = end === -1 ? source.length : end + terminatorLength;
  return { text: source.slice(start, next), next, kind };
}

/**
 * @param {string} source
 * @param {number} start
 * @param {string} quote
 * @returns {Span}
 */
function stringAt(source, start, quote) {
  let j = start + 1;
  while (j < source.length && source[j] !== quote) j += source[j] === "\\" ? 2 : 1;
  return until(source, start, j < source.length ? j : -1, 1, "string");
}

/** @param {string} text */
function blank(text) {
  return text.replace(/[^\n]/g, " ");
}

/**
 * 1-based line number of an offset.
 *
 * @param {string} source
 * @param {number} offset
 */
export function lineOf(source, offset) {
  return source.slice(0, offset).split("\n").length;
}
