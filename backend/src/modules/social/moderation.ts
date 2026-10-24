import { db, space } from "../../env/index.ts";
import type { IndexedPost } from "./access.ts";
import type { ContentState } from "./do/space.ts";
import { REMOVED_KEPT_MS } from "./do/space-schema.ts";
import { deleteKeys, purgeRemovedCommentMedia } from "./media.ts";
import { unindex } from "./posts.ts";

// What moderation does to a community's content (decisions 0063, 0066): it
// hides, removes and restores posts and comments, and the moderation log's
// entry goes with each. A removed post's text is deleted 90 days after its
// removal, by the daily cron; a removed comment's by its space's alarm.

/** What moderation acts on: where it is, who wrote it, and its state. */
export type Content = {
  communityId: string;
  postId: string;
  authorId: string;
  state: ContentState;
};

/** A post's place and author, whatever its state; null when there is none. */
export async function postContent(env: Env, postId: string): Promise<Content | null> {
  return db(env)
    .prepare(
      `SELECT community_id AS communityId, post_id AS postId, author_id AS authorId, state
         FROM post_index WHERE post_id = ?`,
    )
    .bind(postId)
    .first<Content>();
}

/** A comment's place and author, whatever its state; null when there is none. */
export async function commentContent(env: Env, commentId: string): Promise<Content | null> {
  // A comment id is its post's id, a dash and its own part (posts.ts).
  const postId = commentId.slice(0, Math.max(0, commentId.lastIndexOf("-")));
  const post = postId ? await postContent(env, postId) : null;
  const comment = post && (await space(env, post.communityId).comment(commentId));
  return comment && post
    ? { communityId: post.communityId, postId, authorId: comment.author, state: comment.state }
    : null;
}

/** Sets a post's state, with `entries` in the same batch. */
export async function moderatePost(
  env: Env,
  postId: string,
  state: IndexedPost["state"],
  entries: D1PreparedStatement[],
): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare("UPDATE post_index SET state = ?, moderated_at = ? WHERE post_id = ?")
      .bind(state, Date.now(), postId),
    ...entries,
  ]);
}

/**
 * Sets a comment's state. Its space is not D1, so the entries are written first:
 * a failure between the two leaves an entry for an action to repeat, never an
 * action without its entry.
 */
export async function moderateComment(
  env: Env,
  communityId: string,
  commentId: string,
  state: ContentState,
  entries: D1PreparedStatement[],
): Promise<void> {
  await db(env).batch([
    ...entries,
    // The image of a removed comment is purged when the comment's text is (0082).
    db(env)
      .prepare("UPDATE social_media SET removed_at = ? WHERE comment_id = ?")
      .bind(state === "removed" ? Date.now() : null, commentId),
  ]);
  await space(env, communityId).moderateComment(commentId, state, Date.now());
}

/**
 * Deletes the posts removed REMOVED_KEPT_MS ago, with their comments and
 * images, and the images of comments removed that long ago (decision 0082:
 * the space's alarm deletes those comments' text, and cannot reach D1 or R2).
 * The number of posts.
 */
export async function purgeRemoved(env: Env, now = Date.now()): Promise<number> {
  await purgeRemovedCommentMedia(env, now);
  const { results } = await db(env)
    .prepare(
      `SELECT community_id AS communityId, post_id AS postId FROM post_index
        WHERE state = 'removed' AND moderated_at <= ? LIMIT 500`,
    )
    .bind(now - REMOVED_KEPT_MS)
    .all<{ communityId: string; postId: string }>();
  for (const [communityId, posts] of Map.groupBy(results, (r) => r.communityId)) {
    const ids = posts.map((p) => p.postId);
    for (const postId of ids) await space(env, communityId).deletePost(postId);
    await deleteKeys(env, await unindex(env, communityId, ids));
  }
  return results.length;
}
