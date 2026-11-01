// A text's length as the server's validator counts it: code points (decision
// 0123). `String.length` and an input's `maxLength` count UTF-16 units, so they
// stop a text of emoji at half the limit, and can leave half a character.

/** A text's length in code points. */
export function textLength(text: string): number {
  return Array.from(text).length;
}

/** What a field keeps of `text` at `limit` code points. */
export function clipText(text: string, limit: number): string {
  // Short enough in UTF-16 is short enough in code points, and most text is.
  if (text.length <= limit) return text;
  return Array.from(text).slice(0, limit).join("");
}
