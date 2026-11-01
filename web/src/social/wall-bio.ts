import { LIMITS } from "../generated/limits.ts";
import { textLength } from "../lib/char-count.ts";

// The bio on a wall (decision 0115): one line, in code points,
// the contract's limit. The server is the judge; this keeps the editor from
// offering a save it knows will be refused.

const BIO_LIMIT = LIMITS.bioChars;

/** The text as the bio will be stored: no line breaks, trimmed. */
export function cleanBio(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Whether `value` is longer than a bio may be, counted in code points. */
export function bioTooLong(value: string): boolean {
  return textLength(cleanBio(value)) > BIO_LIMIT;
}
