export type EmojiCount = Readonly<{ emoji: string; count: number }>;

/**
 * The counts the server gave, moved by what the caller changed since: `first` is the caller's
 * reaction in those counts, `mine` the one now. Most used first, equal counts in the server's
 * order, the caller's new emoji last among its equals; an emoji with no reactions left is gone.
 */
export function tally(server: readonly EmojiCount[], first: string | null, mine: string | null) {
  const counts = new Map(server.map((r) => [r.emoji, r.count]));
  const count = (emoji: string) =>
    (counts.get(emoji) ?? 0) - (first === emoji ? 1 : 0) + (mine === emoji ? 1 : 0);
  const keys = [...counts.keys()];
  if (mine !== null && !counts.has(mine)) keys.push(mine);
  const emojis = keys
    .map((emoji) => ({ emoji, count: count(emoji) }))
    .filter((r) => r.count > 0)
    .sort((x, y) => y.count - x.count);
  const total = emojis.reduce((sum, r) => sum + r.count, 0);
  return { emojis, total, count };
}
