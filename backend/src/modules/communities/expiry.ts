import { deleteCommunityRows, expiredReadOnly } from "./communities.ts";

/** What a community's deletion removes beyond its rows: its space's content (decision 0063). */
export type BeforeDelete = (env: Env, communityId: string) => Promise<void>;

/** Deletes the read-only communities past their 90 days (decision 0063); how many. */
export async function expireCommunities(
  env: Env,
  beforeDelete: BeforeDelete,
  now = Date.now(),
): Promise<number> {
  const ids = await expiredReadOnly(env, now);
  for (const communityId of ids) {
    await beforeDelete(env, communityId);
    await deleteCommunityRows(env, communityId);
  }
  return ids.length;
}
