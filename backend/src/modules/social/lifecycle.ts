import { db, space } from "../../env/index.ts";
import {
  deleteCommentMediaOf,
  deleteCommunityMedia,
  deleteKeys,
  deleteUnattached,
} from "./media.ts";
import { unindex } from "./posts.ts";

// What deleting a community or an account removes of the content (decisions
// 0063, 0070). A purged community's row stays a year for its log, so its
// space, its images and its rows here are deleted when it is purged.

/** Deletes a community's space, images and index; called when it is purged. */
export async function dropSpace(env: Env, communityId: string): Promise<void> {
  await space(env, communityId).drop();
  await deleteCommunityMedia(env, communityId);
  await db(env).batch(
    (["post_index", "social_media", "space_authors"] as const).map((table) =>
      db(env).prepare(`DELETE FROM ${table} WHERE community_id = ?`).bind(communityId),
    ),
  );
}

/** Deletes posts of a community with their comments, reactions and images. */
export async function deletePosts(env: Env, communityId: string, postIds: string[]): Promise<void> {
  for (const postId of postIds) await space(env, communityId).deletePost(postId);
  await deleteKeys(env, await unindex(env, communityId, postIds));
}

/**
 * Deletes the posts a moderator has not taken down and answers with those they
 * have, which stay as they are so that deleting cannot erase a moderator's record.
 */
export async function deleteUnlessModerated(
  env: Env,
  communityId: string,
  postIds: string[],
): Promise<string[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT post_id AS postId FROM post_index
        WHERE post_id IN (SELECT value FROM json_each(?)) AND state IN ('removed', 'hidden')`,
    )
    .bind(JSON.stringify(postIds))
    .all<{ postId: string }>();
  const kept = results.map((r) => r.postId);
  const keptSet = new Set(kept);
  await deletePosts(
    env,
    communityId,
    postIds.filter((id) => !keptSet.has(id)),
  );
  return kept;
}

/**
 * Deletes everything `accountId` wrote in any space: its posts with their
 * comments, reactions and images, its comments, their images and reactions on other posts,
 * and its uploads no post took. Called before the account's row goes.
 */
export async function forgetAccount(env: Env, accountId: string): Promise<void> {
  // Its comment images first, in posts of other people too (decision 0082).
  await deleteCommentMediaOf(env, accountId);
  const { results } = await db(env)
    .prepare("SELECT community_id FROM space_authors WHERE account_id = ?")
    .bind(accountId)
    .all<{ community_id: string }>();
  for (const { community_id: communityId } of results) {
    const postIds = await space(env, communityId).forget(accountId);
    await deleteKeys(env, await unindex(env, communityId, postIds));
  }
  await deleteUnattached(env, { uploader: accountId });
}
