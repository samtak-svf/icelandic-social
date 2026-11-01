// What one account wrote in a space, a page at a time, for its own export
// (decision 0126). Rows are read in the order of their id, so a page's last id
// is the keyset the next page starts after. A removed or hidden item is read
// like any other: its state is the Worker's to put in the file, not this
// object's to hide.

export type OwnStage = "posts" | "comments" | "reactions" | "comment_reactions" | "votes";

type OwnPost = {
  postId: string;
  body: string;
  media: { mediaId: string }[];
  createdAt: number;
  anonymous: boolean;
  poll: { options: { optionId: string; text: string }[]; myOption: string | null } | null;
};
type OwnComment = {
  commentId: string;
  postId: string;
  parentCommentId: string | null;
  body: string;
  createdAt: number;
  state: "visible" | "hidden" | "removed";
};
type OwnReaction = { id: string; emoji?: string; createdAt?: number; optionId?: string };

export type OwnPage = {
  posts?: OwnPost[];
  comments?: OwnComment[];
  reactions?: OwnReaction[];
  /** The id the next page starts after, or null when this was the last. */
  next: string | null;
};

export function ownPage(
  sql: SqlStorage,
  account: string,
  stage: OwnStage,
  after: string,
  limit: number,
): OwnPage {
  const rows = <T extends Record<string, SqlStorageValue>>(query: string, ...bindings: unknown[]) =>
    sql.exec<T>(query, ...bindings).toArray();
  // One row more than the page, to know whether another page follows.
  const take = limit + 1;
  if (stage === "posts") {
    const found = rows<{
      post_id: string;
      body: string;
      media: string;
      created_at: number;
      anonymous: number;
    }>(
      `SELECT post_id, body, media, created_at, anonymous FROM posts
        WHERE author = ? AND post_id > ? ORDER BY post_id LIMIT ?`,
      account,
      after,
      take,
    );
    const page = found.slice(0, limit);
    const posts = page.map((row): OwnPost => {
      const options = rows<{ option_id: string; text: string }>(
        "SELECT option_id, text FROM poll_options WHERE post_id = ? ORDER BY position",
        row.post_id,
      );
      const vote = rows<{ option_id: string }>(
        "SELECT option_id FROM poll_votes WHERE post_id = ? AND account = ?",
        row.post_id,
        account,
      )[0];
      return {
        postId: row.post_id,
        body: row.body,
        media: (JSON.parse(row.media) as { mediaId: string }[]).map((m) => ({
          mediaId: m.mediaId,
        })),
        createdAt: row.created_at,
        anonymous: row.anonymous === 1,
        poll:
          options.length === 0
            ? null
            : {
                options: options.map((o) => ({ optionId: o.option_id, text: o.text })),
                myOption: vote?.option_id ?? null,
              },
      };
    });
    return { posts, next: found.length > limit ? page[limit - 1]!.post_id : null };
  }
  if (stage === "comments") {
    const found = rows<{
      comment_id: string;
      post_id: string;
      parent_comment_id: string | null;
      body: string;
      created_at: number;
      state: OwnComment["state"];
    }>(
      `SELECT comment_id, post_id, parent_comment_id, body, created_at, state FROM comments
        WHERE author = ? AND comment_id > ? ORDER BY comment_id LIMIT ?`,
      account,
      after,
      take,
    );
    const page = found.slice(0, limit);
    return {
      comments: page.map((r) => ({
        commentId: r.comment_id,
        postId: r.post_id,
        parentCommentId: r.parent_comment_id,
        body: r.body,
        createdAt: r.created_at,
        state: r.state,
      })),
      next: found.length > limit ? page[limit - 1]!.comment_id : null,
    };
  }
  const query = {
    reactions: `SELECT post_id AS id, emoji, created_at AS createdAt, NULL AS optionId FROM reactions
                 WHERE account = ? AND post_id > ? ORDER BY post_id LIMIT ?`,
    comment_reactions: `SELECT comment_id AS id, NULL AS emoji, created_at AS createdAt, NULL AS optionId
                         FROM comment_reactions WHERE account = ? AND comment_id > ?
                         ORDER BY comment_id LIMIT ?`,
    votes: `SELECT post_id AS id, NULL AS emoji, NULL AS createdAt, option_id AS optionId
              FROM poll_votes WHERE account = ? AND post_id > ? ORDER BY post_id LIMIT ?`,
  }[stage];
  const found = rows<{
    id: string;
    emoji: string | null;
    createdAt: number | null;
    optionId: string | null;
  }>(query, account, after, take);
  const page = found.slice(0, limit);
  return {
    reactions: page.map((r) => ({
      id: r.id,
      ...(r.emoji !== null ? { emoji: r.emoji } : {}),
      ...(r.createdAt !== null ? { createdAt: r.createdAt } : {}),
      ...(r.optionId !== null ? { optionId: r.optionId } : {}),
    })),
    next: found.length > limit ? page[limit - 1]!.id : null,
  };
}
