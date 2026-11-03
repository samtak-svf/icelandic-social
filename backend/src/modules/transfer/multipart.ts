// The multipart/related body a file item comes in (decision 0129): a JSON part that
// describes the file, then the file's bytes. The body is read whole, within a cap, and
// split at its boundary; anything that is not two such parts is refused.

export type Part = { type: string; bytes: Uint8Array };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The boundary a content type names (RFC 2046 5.1.1), or null. */
export function boundaryOf(contentType: string): string | null {
  if (!/^multipart\/(related|form-data|mixed)\s*;/i.test(contentType)) return null;
  const found = /;\s*boundary=(?:"([^"]{1,70})"|([^\s;"]{1,70}))/i.exec(contentType);
  return found?.[1] ?? found?.[2] ?? null;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0];
  outer: for (
    let i = haystack.indexOf(first ?? 0, from);
    i !== -1;
    i = haystack.indexOf(first ?? 0, i + 1)
  ) {
    if (i + needle.length > haystack.length) return -1;
    for (let j = 1; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

/** The parts of `body`, in order, or null when it is not a multipart body. */
export function partsOf(body: Uint8Array, boundary: string): Part[] | null {
  const delimiter = encoder.encode(`--${boundary}`);
  let at = indexOf(body, delimiter, 0);
  if (at === -1) return null;
  const parts: Part[] = [];
  for (;;) {
    at += delimiter.length;
    // `--` after a delimiter closes the body.
    if (body[at] === 0x2d && body[at + 1] === 0x2d) return parts;
    const next = indexOf(body, encoder.encode(`\r\n--${boundary}`), at);
    if (next === -1) return null;
    const part = body.subarray(at, next);
    // The part opens with the line break after the delimiter, then headers, then a blank line.
    const blank = indexOf(part, encoder.encode("\r\n\r\n"), 0);
    if (blank === -1) return null;
    const headers = decoder.decode(part.subarray(0, blank));
    const type = /(?:^|\r\n)content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? "";
    parts.push({ type, bytes: part.subarray(blank + 4) });
    at = next + 2;
  }
}
