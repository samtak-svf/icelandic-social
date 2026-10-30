import { db } from "../../env/index.ts";
import { blockedEither, UNBLOCKED } from "../../identity/index.ts";
import { requestRelation, type Relation } from "./requests.ts";
import { SUMMARY, summaryOf, type SummaryRow } from "./summary.ts";

// The person screen's data (decision 0114). Someone else's friends are shown
// only as their count and the mutual ones: the viewer's set joined with theirs,
// which the cap bounds at 1,000 probes.

/** How many mutual friends and shared communities a screen names; the count is whole. */
const NAMED = 20;

type Shared = { communityId: string; name: string; photo: string | null };

type ScreenRow = SummaryRow & Shared & { n: number; since: number; until: number };

/** The screen's rows, read at one moment. */
function screenRows(env: Env, viewer: string, accountId: string, now: number) {
  return db(env).batch<ScreenRow>([
    db(env).prepare(`SELECT ${SUMMARY} FROM accounts a WHERE a.account_id = ?`).bind(accountId),
    db(env).prepare("SELECT COUNT(*) AS n FROM friendships WHERE account_id = ?").bind(accountId),
    db(env)
      .prepare(
        `SELECT COUNT(*) AS n FROM friendships mine
           JOIN friendships theirs ON theirs.friend_id = mine.friend_id
          WHERE mine.account_id = ?1 AND theirs.account_id = ?2 AND ?1 != ?2
            AND ${UNBLOCKED("?1", "mine.friend_id")}`,
      )
      .bind(viewer, accountId),
    db(env)
      .prepare(
        `SELECT ${SUMMARY} FROM friendships mine
           JOIN friendships theirs ON theirs.friend_id = mine.friend_id
           JOIN accounts a ON a.account_id = mine.friend_id
          WHERE mine.account_id = ?1 AND theirs.account_id = ?2 AND ?1 != ?2
            AND ${UNBLOCKED("?1", "mine.friend_id")}
          ORDER BY a.name_key, a.account_id LIMIT ${NAMED}`,
      )
      .bind(viewer, accountId),
    db(env)
      .prepare(
        `SELECT c.community_id AS communityId, c.name, c.photo_version AS photo
           FROM community_members mine
           JOIN community_members theirs ON theirs.community_id = mine.community_id
           JOIN live_communities c ON c.community_id = mine.community_id
          WHERE mine.account_id = ?1 AND theirs.account_id = ?2 AND ?1 != ?2
          ORDER BY c.name_key, c.community_id LIMIT ${NAMED}`,
      )
      .bind(viewer, accountId),
    db(env)
      .prepare("SELECT since FROM friendships WHERE account_id = ? AND friend_id = ?")
      .bind(viewer, accountId),
    db(env)
      .prepare(
        "SELECT until FROM person_snoozes WHERE account_id = ? AND target_id = ? AND until > ?",
      )
      .bind(viewer, accountId, now),
  ]);
}

const rowsOf = (result: D1Result<ScreenRow> | undefined) => result?.results ?? [];

async function relationTo(
  env: Env,
  viewer: string,
  accountId: string,
  friendsSince: number | null,
  now: number,
): Promise<Relation | "self"> {
  if (viewer === accountId) return "self";
  if (friendsSince !== null) return "friends";
  return requestRelation(env, viewer, accountId, now);
}

/** What `viewer` sees of `accountId`; null for nobody, or across a block either way. */
export async function personView(env: Env, viewer: string, accountId: string, now = Date.now()) {
  if ((await blockedEither(env, viewer)).includes(accountId)) return null;
  const [found, friends, mutualCount, mutual, shared, since, snoozed] = await screenRows(
    env,
    viewer,
    accountId,
    now,
  );
  const [row] = rowsOf(found);
  if (row === undefined) return null;
  const friendsSince = rowsOf(since)[0]?.since ?? null;
  return {
    ...summaryOf(row),
    relation: await relationTo(env, viewer, accountId, friendsSince, now),
    friendsSince,
    friendCount: rowsOf(friends)[0]?.n ?? 0,
    mutualCount: rowsOf(mutualCount)[0]?.n ?? 0,
    mutualFriends: rowsOf(mutual).map(summaryOf),
    sharedCommunities: rowsOf(shared).map((c) => ({
      communityId: c.communityId,
      name: c.name,
      photo: c.photo,
    })),
    snoozedUntil: rowsOf(snoozed)[0]?.until ?? null,
  };
}
