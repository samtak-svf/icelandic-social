import { db, space } from "../../env/index.ts";
import type { ContentState } from "./do/space.ts";
import { deleteKeys } from "./media.ts";
import { authors, unindex } from "./posts.ts";

// Restoring one community's space to a point in time (decision 0068). The
// space's SQLite storage goes back; D1 does not, and D1 stays the truth of
// what exists: a post deleted since is deleted again, a post written since
// leaves the index with its images, an account deleted since is forgotten
// again, and a comment keeps the state the moderation log last gave it.

/** Where a space goes back to: a time, or a bookmark an earlier restore returned. */
export type RestoreTarget = { at: number } | { bookmark: string };

/** A comment's latest state in the moderation log, and when it was given. */
export type Moderated = { commentId: string; state: ContentState; at: number };

/** What reconciling a space with D1 changed, as counts. */
export type Reconciled = {
  postsDeleted: number;
  postsUnindexed: number;
  accountsForgotten: number;
  commentsModerated: number;
};

/**
 * Restores `communityId`'s space to `target` and reconciles it with D1; the
 * bookmark that undoes the restore, and what reconciling changed.
 */
export async function restoreSpace(
  env: Env,
  communityId: string,
  target: RestoreTarget,
  moderated: Moderated[],
): Promise<{ undo: string } & Reconciled> {
  const undo = await space(env, communityId).restoreTo(target);
  // The call that ends the object's run fails by design; the next starts it
  // on the restored storage.
  await space(env, communityId)
    .restart()
    .catch(() => undefined);
  return { undo, ...(await reconcileSpace(env, communityId, moderated)) };
}

/** Brings `communityId`'s space back in line with D1, after its storage went back. */
export async function reconcileSpace(
  env: Env,
  communityId: string,
  moderated: Moderated[],
): Promise<Reconciled> {
  const held = await space(env, communityId).inventory();
  const { results } = await db(env)
    .prepare("SELECT post_id FROM post_index WHERE community_id = ?")
    .bind(communityId)
    .all<{ post_id: string }>();
  const indexed = new Set(results.map((r) => r.post_id));
  const kept = new Set(held.posts);

  const deleted = held.posts.filter((id) => !indexed.has(id));
  for (const postId of deleted) await space(env, communityId).deletePost(postId);
  const written = [...indexed].filter((id) => !kept.has(id));
  await deleteKeys(env, await unindex(env, communityId, written));

  const live = await authors(env, held.accounts);
  const gone = held.accounts.filter((a) => !live.has(a));
  for (const account of gone) {
    const posts = await space(env, communityId).forget(account);
    await deleteKeys(env, await unindex(env, communityId, posts));
  }

  const comments = new Set(held.comments);
  let commentsModerated = 0;
  for (const m of moderated) {
    if (!comments.has(m.commentId)) continue;
    if (await space(env, communityId).moderateComment(m.commentId, m.state, m.at)) {
      commentsModerated += 1;
    }
  }
  return {
    postsDeleted: deleted.length,
    postsUnindexed: written.length,
    accountsForgotten: gone.length,
    commentsModerated,
  };
}
