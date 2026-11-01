// The `Range` header of a download from R2, shared by every route that serves a stored object.

/**
 * What a `Range` header asks of an object of `size` bytes (RFC 9110 § 14): the
 * whole object for no header or a unit other than bytes, a single `a-b` or `a-`
 * range clamped to the end, or "unsatisfiable" for a range past the end, a
 * reversed, suffix or multiple range, or one that is not a range at all.
 */
export function rangeOf(
  header: string | undefined,
  size: number,
): "whole" | "unsatisfiable" | { offset: number; length: number } {
  if (header === undefined || !/^bytes\s*=/i.test(header)) return "whole";
  const match = /^bytes\s*=\s*(\d{1,15})-(\d{1,15})?\s*$/i.exec(header);
  if (!match) return "unsatisfiable";
  const first = Number(match[1]);
  const last = match[2] === undefined ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (first >= size || first > last) return "unsatisfiable";
  return { offset: first, length: last - first + 1 };
}
