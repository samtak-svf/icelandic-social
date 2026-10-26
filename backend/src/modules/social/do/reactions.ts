import { emojiOfKind, kindOfEmoji, REACTIONS, type ReactionKind } from "../../../api/social.ts";

/**
 * A reaction row holds the emoji itself (decision 0100). A space made before
 * it has the column `kind` with one of the five old kinds: it is renamed and
 * its values mapped in one step, as a repair on open, so a repeat finds
 * nothing to do and no reaction is lost.
 */
export function ensureEmojiReactions(sql: SqlStorage): void {
  const columns = sql.exec<{ name: string }>("PRAGMA table_info(reactions)").toArray();
  if (!columns.some((c) => c.name === "kind")) return;
  sql.exec("ALTER TABLE reactions RENAME COLUMN kind TO emoji");
  for (const kind of REACTIONS) {
    sql.exec("UPDATE reactions SET emoji = ? WHERE emoji = ?", emojiOfKind(kind), kind);
  }
}

/** A post's reaction fields from its emoji counts (most used first) and the viewer's emoji. */
export function reactionViews(
  counts: { emoji: string; count: number }[],
  mine: string | null,
): {
  reactions: { kind: ReactionKind; count: number }[];
  myReaction: ReactionKind | null;
  emojis: { emoji: string; count: number }[];
  myEmoji: string | null;
} {
  const kinds = new Map<ReactionKind, number>();
  for (const { emoji, count } of counts) {
    const kind = kindOfEmoji(emoji);
    if (kind) kinds.set(kind, count);
  }
  return {
    reactions: [...kinds].map(([kind, count]) => ({ kind, count })),
    myReaction: mine === null ? null : kindOfEmoji(mine),
    emojis: counts.map(({ emoji, count }) => ({ emoji, count })),
    myEmoji: mine,
  };
}

/** Sets, replaces or (with null) removes `account`'s emoji on a post; false when the post is not here. */
export function setReaction(
  sql: SqlStorage,
  postId: string,
  account: string,
  emoji: string | null,
): boolean {
  if (!sql.exec("SELECT 1 FROM posts WHERE post_id = ?", postId).toArray().length) return false;
  if (emoji === null) {
    sql.exec("DELETE FROM reactions WHERE post_id = ? AND account = ?", postId, account);
  } else {
    sql.exec(
      `INSERT INTO reactions (post_id, account, emoji, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (post_id, account) DO UPDATE SET emoji = excluded.emoji`,
      postId,
      account,
      emoji,
      Date.now(),
    );
  }
  return true;
}
