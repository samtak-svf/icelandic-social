import { db } from "../../env/index.ts";

// Taking back what a friend's notice said (decision 0114). A request's notice
// stands only while the request does: when it is answered, cancelled or expires
// the row goes in the same batch, and a job not yet run finds it no longer so.
// An actor row goes with its notification.

const FRIEND_KINDS = "('friend_request', 'friend_accepted')";

/** The notice telling `to` of a request from `from`. */
export function withdrawingRequestNotice(env: Env, to: string, from: string): D1PreparedStatement {
  return db(env)
    .prepare(
      "DELETE FROM notifications WHERE account_id = ? AND actor_id = ? AND kind = 'friend_request'",
    )
    .bind(to, from);
}

/** Every friend's notice between two accounts, both ways: a block leaves none. */
export function withdrawingFriendNotices(
  env: Env,
  one: string,
  other: string,
): D1PreparedStatement {
  return db(env)
    .prepare(
      `DELETE FROM notifications WHERE kind IN ${FRIEND_KINDS}
          AND ((account_id = ?1 AND actor_id = ?2) OR (account_id = ?2 AND actor_id = ?1))`,
    )
    .bind(one, other);
}

/** What others were told by a deleted account, which would otherwise read as nobody's. */
export function forgettingFriendNotices(env: Env, accountId: string): D1PreparedStatement {
  return db(env)
    .prepare(`DELETE FROM notifications WHERE kind IN ${FRIEND_KINDS} AND actor_id = ?`)
    .bind(accountId);
}
