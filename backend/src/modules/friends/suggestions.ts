import { db } from "../../env/index.ts";
import { NOT_SUSPENDED, UNBLOCKED } from "../../identity/index.ts";
import {
  AFTER_DIRECTORY,
  DIRECTORY_ORDER,
  type DirectoryCursor,
  directoryPage,
  type DirectoryRow,
  IN_DIRECTORY,
} from "../profiles/index.ts";
import { NOT_FRIENDS } from "./friendships.ts";
import { NO_REQUEST_CLOCK } from "./requests.ts";
import { SUMMARY } from "./summary.ts";

// Friend suggestions (decision 0114). The one source is co-membership of an open
// community, because a private community's membership must not reach a third party.
// `live_communities` holds no wall, and the audience is matched as 'open' and never as
// "not private", so a new kind of space or audience denies by default. Mutual friends and
// contacts are never read. The answer is ordered by name and carries an account's summary
// alone, so nothing in it says which community links two people, or how many do.

/**
 * A page of `viewer`'s suggestions, from the directory's accounts and in its order. A viewer who
 * is opted out or suspended gets none: being suggested and being shown are one setting, and a
 * suspended account could not ask any of them (decision 0115).
 */
export async function suggestions(
  env: Env,
  viewer: string,
  options: { after?: DirectoryCursor | undefined; limit: number },
  now = Date.now(),
): Promise<{ items: ReturnType<typeof directoryPage>["items"]; next: string | null }> {
  const { after, limit } = options;
  const { results } = await db(env)
    .prepare(
      `SELECT ${SUMMARY}, a.name_key AS key
         FROM accounts a
        WHERE a.account_id IN (SELECT theirs.account_id
                                 FROM community_members mine
                                 JOIN live_communities c ON c.community_id = mine.community_id
                                 JOIN community_members theirs ON theirs.community_id = mine.community_id
                                WHERE mine.account_id = ?1 AND c.audience = 'open')
          AND a.account_id != ?1
          AND ${IN_DIRECTORY}
          AND a.in_suggestions = 1
          AND ${NOT_SUSPENDED("a", "?2")}
          AND ${UNBLOCKED("?1", "a.account_id")}
          AND ${NOT_FRIENDS("?1", "a.account_id")}
          AND ${NO_REQUEST_CLOCK("?1", "a.account_id", "?2")}
          AND EXISTS (SELECT 1 FROM accounts me
                       WHERE me.account_id = ?1 AND me.in_suggestions = 1
                         AND ${NOT_SUSPENDED("me", "?2")})
          AND ${AFTER_DIRECTORY("?3", "?4", "?5")}
        ORDER BY ${DIRECTORY_ORDER}
        LIMIT ?6`,
    )
    .bind(viewer, now, after?.verified ?? null, after?.key ?? null, after?.id ?? null, limit + 1)
    .all<DirectoryRow>();
  return directoryPage(results, limit);
}
