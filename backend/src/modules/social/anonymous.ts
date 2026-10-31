import { db, space } from "../../env/index.ts";
import { notePost } from "../communities/index.ts";
import { type IndexedPost, spaceAccess } from "./access.ts";
import { deleteKeys } from "./media.ts";
import { parseCursor } from "./post-page.ts";
import { type Post, render, unindex } from "./posts.ts";

// The anonymous posts waiting for a moderator (decision 0091). The caller has
// already decided that the account may moderate the community.

/** A pending anonymous post's place and author, or null when the post is not one. */
export async function pendingAnonymous(env: Env, postId: string): Promise<IndexedPost | null> {
  return db(env)
    .prepare(
      `SELECT post_id AS postId, community_id AS communityId, author_id AS authorId,
              created_at AS createdAt, state, anonymous
         FROM post_index WHERE post_id = ? AND state = 'pending' AND anonymous = 1`,
    )
    .bind(postId)
    .first<IndexedPost>();
}

/** A page of a community's pending anonymous posts, newest first, each without its author. */
export async function pendingQueue(
  env: Env,
  moderator: string,
  communityId: string,
  before: string | undefined,
  limit: number,
): Promise<{ posts: Post[]; next: string | null } | null> {
  const access = await spaceAccess(env, moderator, communityId);
  if (!access) return null;
  const cursor = parseCursor(before);
  const { results } = await db(env)
    .prepare(
      `SELECT post_id AS postId, community_id AS communityId, author_id AS authorId,
              created_at AS createdAt, state, anonymous, audience, imported
         FROM post_index
        WHERE community_id = ?1 AND state = 'pending' AND anonymous = 1
          AND (?2 IS NULL OR created_at < ?2
               OR (created_at = ?2 AND (?3 IS NULL OR post_id < ?3)))
        ORDER BY created_at DESC, post_id DESC LIMIT ?4`,
    )
    .bind(communityId, cursor?.t ?? null, cursor?.id ?? null, limit + 1)
    .all<IndexedPost>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return {
    posts: await render(env, page, access.viewer),
    next: results.length > limit && last ? `${last.createdAt}-${last.postId}` : null,
  };
}

/**
 * Publishes `post`: it is dated now, so it enters the feed where readers are
 * looking, and the community's unread count moves then, not when it was
 * written. False when another moderator got there first.
 */
export async function publishPending(env: Env, post: IndexedPost): Promise<boolean> {
  const now = Date.now();
  const [changed] = await db(env).batch([
    db(env)
      .prepare(
        `UPDATE post_index SET state = 'visible', created_at = ?2
          WHERE post_id = ?1 AND state = 'pending' AND anonymous = 1`,
      )
      .bind(post.postId, now),
  ]);
  if (!changed || changed.meta.changes === 0) return false;
  await space(env, post.communityId).publishPost(post.postId, now);
  await db(env).batch(notePost(env, post.communityId, post.authorId, now));
  return true;
}

/** Deletes `post` and its images; false when another moderator got there first. */
export async function deletePending(env: Env, post: IndexedPost): Promise<boolean> {
  if (!(await pendingAnonymous(env, post.postId))) return false;
  await space(env, post.communityId).deletePost(post.postId);
  await deleteKeys(env, await unindex(env, post.communityId, [post.postId]));
  return true;
}
