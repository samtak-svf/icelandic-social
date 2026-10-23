import { db } from "../../env/index.ts";

// The hub's own tables (decision 0080): what an account has read of a
// community, its pins, and the post count that unread is measured against.

/** Pins `communityId` for `viewer`; pinning it again keeps the first pin's place. */
export async function pinCommunity(env: Env, viewer: string, communityId: string): Promise<void> {
  await db(env)
    .prepare(
      `INSERT OR IGNORE INTO community_pins (account_id, community_id, pinned_at) VALUES (?, ?, ?)`,
    )
    .bind(viewer, communityId, Date.now())
    .run();
}

/** Unpins `communityId` for `viewer`; nothing when it was not pinned. */
export async function unpinCommunity(env: Env, viewer: string, communityId: string): Promise<void> {
  await db(env)
    .prepare("DELETE FROM community_pins WHERE account_id = ? AND community_id = ?")
    .bind(viewer, communityId)
    .run();
}

/**
 * The statement that moves `viewer`'s read mark in `communityId` to the
 * community's latest post (decision 0080): what opening its feed does.
 */
export function markRead(env: Env, viewer: string, communityId: string): D1PreparedStatement {
  return db(env)
    .prepare(
      `INSERT INTO community_reads (account_id, community_id, read_seq, read_at)
       SELECT ?1, community_id, post_seq, ?3 FROM live_communities WHERE community_id = ?2
       ON CONFLICT (account_id, community_id)
       DO UPDATE SET read_seq = excluded.read_seq, read_at = excluded.read_at`,
    )
    .bind(viewer, communityId, Date.now());
}

/**
 * The statements that count a new post by `author` in `communityId` (decision
 * 0080), for the batch that creates it. The hub's unread count is a sequence:
 * a post removed or deleted later still counts as posted, the accepted
 * trade-off for counting from D1 without asking the space. The author's own
 * post is not unread to them: a reader who was up to date stays up to date,
 * one who was behind stays behind.
 */
export function notePost(
  env: Env,
  communityId: string,
  author: string,
  at: number,
): D1PreparedStatement[] {
  return [
    db(env)
      .prepare(
        `INSERT INTO community_reads (account_id, community_id, read_seq, read_at)
         SELECT ?1, c.community_id, c.post_seq + 1, ?3 FROM live_communities c
          WHERE c.community_id = ?2
            AND COALESCE((SELECT x.read_seq FROM community_reads x
                           WHERE x.account_id = ?1 AND x.community_id = ?2), 0) = c.post_seq
         ON CONFLICT (account_id, community_id)
         DO UPDATE SET read_seq = excluded.read_seq, read_at = excluded.read_at`,
      )
      .bind(author, communityId, at),
    db(env)
      .prepare(
        "UPDATE communities SET post_seq = post_seq + 1, last_post_at = ?2 WHERE community_id = ?1",
      )
      .bind(communityId, at),
  ];
}
