import { db, space } from "../../env/index.ts";
import type { IndexedPost } from "./access.ts";
import type { ContentState } from "./do/space.ts";
import { REMOVED_KEPT_MS } from "./do/space-schema.ts";
import { deletePosts } from "./lifecycle.ts";
import { purgeRemovedCommentMedia } from "./media.ts";

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
  /** 1 for an anonymous post (decision 0091); a comment is never anonymous. */
  anonymous: number;
};

/**
 * A post's place and author, whatever its state; null when there is none. A post an
 * import holds is none to anyone who acts on content: it is its author's alone (0127).
 */
export async function postContent(env: Env, postId: string): Promise<Content | null> {
  return db(env)
    .prepare(
      `SELECT community_id AS communityId, post_id AS postId, author_id AS authorId, state,
              anonymous
         FROM post_index WHERE post_id = ? AND state != 'held'`,
    )
    .bind(postId)
    .first<Content>();
}

/** The post a comment is on: a comment id is its post's id, a dash and its own part (posts.ts). */
export function postOfComment(commentId: string): string {
  return commentId.slice(0, Math.max(0, commentId.lastIndexOf("-")));
}

/** A comment's place and author, whatever its state; null when there is none. */
export async function commentContent(env: Env, commentId: string): Promise<Content | null> {
  const postId = postOfComment(commentId);
  const post = postId ? await postContent(env, postId) : null;
  const comment = post && (await space(env, post.communityId).comment(commentId));
  return comment && post
    ? {
        communityId: post.communityId,
        postId,
        authorId: comment.author,
        state: comment.state,
        anonymous: 0,
      }
    : null;
}

/**
 * The text of a post or comment while it is kept, whatever its state, for the
 * person who wrote it and the moderator who answers them (decision 0115); null
 * once it is gone, or when there never was any.
 */
export async function keptText(
  env: Env,
  communityId: string,
  kind: "post" | "comment",
  id: string,
): Promise<string | null> {
  const stub = space(env, communityId);
  if (kind === "comment") return (await stub.comment(id))?.body || null;
  const [post] = await stub.posts([id], { account: "", hidden: [], moderator: true });
  return post?.body || null;
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
      .prepare("UPDATE social_media SET removed_at = ?, hidden_at = ? WHERE comment_id = ?")
      .bind(
        state === "removed" ? Date.now() : null,
        state === "hidden" ? Date.now() : null,
        commentId,
      ),
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
    await deletePosts(
      env,
      communityId,
      posts.map((p) => p.postId),
    );
  }
  return results.length;
}
