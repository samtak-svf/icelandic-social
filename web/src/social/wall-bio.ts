// The bio on a wall (decision 0115): one line of at most 120 code points,
// the contract's limit. The server is the judge; this keeps the editor from
// offering a save it knows will be refused.

const BIO_LIMIT = 120;

/** The text as the bio will be stored: no line breaks, trimmed. */
export function cleanBio(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/** Whether `value` is longer than a bio may be, counted in code points. */
export function bioTooLong(value: string): boolean {
  return Array.from(cleanBio(value)).length > BIO_LIMIT;
}
