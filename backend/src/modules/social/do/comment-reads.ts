// Reading a space's comments (decisions 0071, 0080): the rows, the tombstones
// and the likes as one viewer sees them. Plain functions over the object's SQL.

export type ContentState = "visible" | "hidden" | "removed";

export type CommentContent = {
  commentId: string;
  postId: string;
  /** The top-level comment this replies to, or null (decision 0071). */
  parentCommentId: string | null;
  author: string;
  body: string;
  createdAt: number;
  state: ContentState;
  /** How many accounts liked it, but those a block hides from the viewer (decision 0080). */
  likes: number;
  /** The viewer liked it. */
  liked: boolean;
};

/** A comment as stored, before the viewer's likes are counted. */
export type CommentRecord = Omit<CommentContent, "likes" | "liked">;

/**
 * Who is looking: the viewer, and the accounts a block stands between it and
 * (decision 0063), whose comments and reactions it does not see. The Worker
 * has already decided the viewer may read the space; a moderator's `hidden`
 * is empty, since a block does not hide content from moderation, and only a
 * moderator sees a hidden or removed comment.
 */
export type Viewer = { account: string; hidden: string[]; moderator: boolean };

export type CommentRow = {
  comment_id: string;
  post_id: string;
  parent_comment_id: string | null;
  author: string;
  body: string;
  created_at: number;
  state: ContentState;
};

export const comment = (r: CommentRow): CommentRecord => ({
  commentId: r.comment_id,
  postId: r.post_id,
  parentCommentId: r.parent_comment_id,
  author: r.author,
  body: r.body,
  createdAt: r.created_at,
  state: r.state,
});

/**
 * A tombstone keeps the slot of a hidden, removed or author-deleted top-level
 * comment that still has a visible reply (decision 0071): no author, no body,
 * shown as removed, so the replies underneath keep their place.
 */
const tombstone = (r: CommentRow): CommentRecord => ({
  commentId: r.comment_id,
  postId: r.post_id,
  parentCommentId: null,
  author: "",
  body: "",
  createdAt: r.created_at,
  state: "removed",
});

/**
 * A post's comments, oldest first, after the cursor `after`. A reply sits
 * in the chronological order at the level of its own `created_at`, one
 * level under its top-level comment (decision 0071). A moderator reads
 * every comment in the order it was written; an ordinary reader reads the
 * visible ones minus those of a block, and keeps a tombstone in the slot
 * of a hidden, removed or author-deleted parent that still has a visible
 * reply to show under, with nothing on it but its place.
 */
export function listComments(
  sql: SqlStorage,
  postId: string,
  viewer: Viewer,
  after: { createdAt: number; id: string } | null,
  limit: number,
): CommentContent[] {
  const afterSql = "AND (?3 IS NULL OR created_at > ?3 OR (created_at = ?3 AND comment_id > ?4))";
  const binds = [
    postId,
    JSON.stringify(viewer.hidden),
    after?.createdAt ?? null,
    after?.id ?? null,
  ];
  const rows: CommentRecord[] = viewer.moderator
    ? sql
        .exec<CommentRow>(
          `SELECT * FROM comments
            WHERE post_id = ?1 AND author NOT IN (SELECT value FROM json_each(?2))
              AND (?6 = 1 OR state = 'visible')
              ${afterSql}
            ORDER BY created_at, comment_id LIMIT ?5`,
          ...binds,
          limit,
          1,
        )
        .toArray()
        .map(comment)
    : [
        ...sql
          .exec<CommentRow>(
            `SELECT * FROM comments
              WHERE post_id = ?1 AND state = 'visible'
                AND author NOT IN (SELECT value FROM json_each(?2))
                ${afterSql}
              ORDER BY created_at, comment_id LIMIT ?5`,
            ...binds,
            limit,
          )
          .toArray()
          .map(comment),
        ...sql
          .exec<CommentRow>(
            `SELECT t.* FROM comments t
              WHERE t.post_id = ?1 AND t.parent_comment_id IS NULL
                AND (t.state != 'visible' OR t.author IN (SELECT value FROM json_each(?2)))
                AND EXISTS (SELECT 1 FROM comments r
                             WHERE r.parent_comment_id = t.comment_id AND r.state = 'visible'
                               AND r.author NOT IN (SELECT value FROM json_each(?2)))
                ${afterSql}
              ORDER BY t.created_at, t.comment_id LIMIT ?5`,
            ...binds,
            limit,
          )
          .toArray()
          .map(tombstone),
      ];
  return withLikes(
    sql,
    rows
      .sort((a, b) => a.createdAt - b.createdAt || (a.commentId < b.commentId ? -1 : 1))
      .slice(0, limit),
    viewer,
  );
}

/**
 * `records` with their likes as `viewer` sees them (decision 0080): the
 * count leaves out the accounts a block hides from the viewer, and a
 * tombstone has none.
 */
function withLikes(sql: SqlStorage, records: CommentRecord[], viewer: Viewer): CommentContent[] {
  if (records.length === 0) return [];
  const wanted = JSON.stringify(records.map((r) => r.commentId));
  const counts = new Map(
    sql
      .exec<{ comment_id: string; count: number }>(
        `SELECT comment_id, COUNT(*) AS count FROM comment_reactions
          WHERE comment_id IN (SELECT value FROM json_each(?1))
            AND account NOT IN (SELECT value FROM json_each(?2))
          GROUP BY comment_id`,
        wanted,
        JSON.stringify(viewer.hidden),
      )
      .toArray()
      .map((r) => [r.comment_id, r.count]),
  );
  const mine = new Set(
    sql
      .exec<{ comment_id: string }>(
        `SELECT comment_id FROM comment_reactions
          WHERE account = ? AND comment_id IN (SELECT value FROM json_each(?))`,
        viewer.account,
        wanted,
      )
      .toArray()
      .map((r) => r.comment_id),
  );
  return records.map((r) => ({
    ...r,
    likes: counts.get(r.commentId) ?? 0,
    liked: mine.has(r.commentId),
  }));
}
