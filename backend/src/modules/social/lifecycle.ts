import { db, space } from "../../env/index.ts";
import { deleteCommunityMedia, deleteKeys, deleteUnattached } from "./media.ts";
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

/**
 * Deletes everything `accountId` wrote in any space: its posts with their
 * comments, reactions and images, its comments and reactions on other posts,
 * and its uploads no post took. Called before the account's row goes.
 */
export async function forgetAccount(env: Env, accountId: string): Promise<void> {
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
