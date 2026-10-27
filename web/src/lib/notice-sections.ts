// The two sections of the notification list (decision 0104): what came after
// the reader last saw the list, and the rest. `seenAt` is the value from
// before this open, or null when the list was never seen.

export function noticeSections<T extends { createdAt: number }>(
  rows: readonly T[],
  seenAt: number | null,
): { fresh: T[]; earlier: T[] } {
  const fresh = rows.filter((n) => seenAt === null || n.createdAt > seenAt);
  return { fresh, earlier: rows.filter((n) => !fresh.includes(n)) };
}
