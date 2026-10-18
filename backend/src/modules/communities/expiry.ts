import { deleteCommunityRows, expiredReadOnly } from "./communities.ts";

/** Deletes the read-only communities past their 90 days (decision 0063); how many. */
export async function expireCommunities(env: Env, now = Date.now()): Promise<number> {
  const ids = await expiredReadOnly(env, now);
  for (const communityId of ids) await deleteCommunityRows(env, communityId);
  return ids.length;
}
