import { db } from "../../env/index.ts";
import { UNBLOCKED } from "../../identity/index.ts";
import { notice } from "../jobs/index.ts";

// Who joins, leaves and moderates a community (decision 0063): the writes to
// its members, requests and invitations.

/** Makes `accountId` a member; any request or invitation it had is used up. */
export async function addMember(env: Env, communityId: string, accountId: string): Promise<void> {
  await db(env).batch(admit(env, communityId, accountId));
}

function admit(env: Env, communityId: string, accountId: string): D1PreparedStatement[] {
  return [
    db(env)
      .prepare(
        `INSERT INTO community_members (community_id, account_id, role, joined_at)
         VALUES (?, ?, 'member', ?) ON CONFLICT DO NOTHING`,
      )
      .bind(communityId, accountId, Date.now()),
    // Only once it is a member: an approval that found no waiting request
    // leaves a decline and an invitation as they were.
    ...(["community_join_requests", "community_invitations"] as const).map((table) =>
      db(env)
        .prepare(
          `DELETE FROM ${table} WHERE community_id = ?1 AND account_id = ?2
              AND EXISTS (SELECT 1 FROM community_members m
                           WHERE m.community_id = ?1 AND m.account_id = ?2)`,
        )
        .bind(communityId, accountId),
    ),
  ];
}

/** Asks to join; a decline past its wait is replaced by the new request. */
export async function requestToJoin(
  env: Env,
  communityId: string,
  accountId: string,
): Promise<void> {
  await db(env)
    .prepare(
      `INSERT INTO community_join_requests (community_id, account_id, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT DO UPDATE SET created_at = excluded.created_at, declined_at = NULL
        WHERE declined_at IS NOT NULL`,
    )
    .bind(communityId, accountId, Date.now())
    .run();
}

/** Removes a waiting request and invitation alike; a decline stays until its wait ends. */
export async function withdraw(env: Env, communityId: string, accountId: string): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare(
        `DELETE FROM community_join_requests
          WHERE community_id = ? AND account_id = ? AND declined_at IS NULL`,
      )
      .bind(communityId, accountId),
    db(env)
      .prepare("DELETE FROM community_invitations WHERE community_id = ? AND account_id = ?")
      .bind(communityId, accountId),
  ]);
}

/** Removes a member who is not the owner; false when there was no such member. */
export async function removeMember(
  env: Env,
  communityId: string,
  accountId: string,
): Promise<boolean> {
  const result = await db(env)
    .prepare(
      `DELETE FROM community_members
        WHERE community_id = ? AND account_id = ? AND role != 'owner'`,
    )
    .bind(communityId, accountId)
    .run();
  return result.meta.changes > 0;
}

/** Approves a waiting join request as `by`, telling its account; false when none waits. */
export async function approve(
  env: Env,
  communityId: string,
  accountId: string,
  by: string,
): Promise<boolean> {
  const now = Date.now();
  const [admitted] = await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO community_members (community_id, account_id, role, joined_at)
         SELECT community_id, account_id, 'member', ?3 FROM community_join_requests
          WHERE community_id = ?1 AND account_id = ?2 AND declined_at IS NULL
         ON CONFLICT DO NOTHING`,
      )
      .bind(communityId, accountId, now),
    // Written only when the request was there to approve.
    notice(
      env,
      `${communityId}:${accountId}:${now}`,
      { kind: "join_approved", accountId, actorId: by, communityId },
      true,
    ),
    ...admit(env, communityId, accountId).slice(1),
  ]);
  return (admitted?.meta.changes ?? 0) > 0;
}

/**
 * Declines a waiting join request (decision 0070): it stays as the account's
 * answer, and keeps it from asking again for 30 days. Declining one that is
 * not there is no error.
 */
export async function decline(env: Env, communityId: string, accountId: string): Promise<void> {
  await db(env)
    .prepare(
      `UPDATE community_join_requests SET declined_at = ?
        WHERE community_id = ? AND account_id = ? AND declined_at IS NULL`,
    )
    .bind(Date.now(), communityId, accountId)
    .run();
}

/**
 * Invites `accountId`, or approves its waiting request; an invitation lifts a
 * decline. "missing" when no such account; "blocked" when a block stands
 * between it and `inviter`.
 */
export async function invite(
  env: Env,
  communityId: string,
  inviter: string,
  accountId: string,
): Promise<"invited" | "joined" | "missing" | "blocked"> {
  const row = await db(env)
    .prepare(
      `SELECT ${UNBLOCKED("?1", "?2")} AS unblocked,
              EXISTS (SELECT 1 FROM community_join_requests
                       WHERE community_id = ?3 AND account_id = ?2
                         AND declined_at IS NULL) AS requested
         FROM accounts WHERE account_id = ?2`,
    )
    .bind(inviter, accountId, communityId)
    .first<{ unblocked: number; requested: number }>();
  if (!row) return "missing";
  if (row.unblocked !== 1) return "blocked";
  if (row.requested === 1) {
    await approve(env, communityId, accountId, inviter);
    return "joined";
  }
  await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO community_invitations (community_id, account_id, created_at)
         SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM community_members
                                              WHERE community_id = ?1 AND account_id = ?2)
         ON CONFLICT DO NOTHING`,
      )
      .bind(communityId, accountId, Date.now()),
    db(env)
      .prepare("DELETE FROM community_join_requests WHERE community_id = ? AND account_id = ?")
      .bind(communityId, accountId),
  ]);
  return "invited";
}

/** Sets a member's role, never the owner's; false when it is not such a member. */
export async function setRole(
  env: Env,
  communityId: string,
  accountId: string,
  role: "moderator" | "member",
): Promise<boolean> {
  const result = await db(env)
    .prepare(
      `UPDATE community_members SET role = ?
        WHERE community_id = ? AND account_id = ? AND role != 'owner'`,
    )
    .bind(role, communityId, accountId)
    .run();
  return result.meta.changes > 0;
}

/** Hands the community from `owner` to the member `to`; false when `to` is not a member. */
export async function transfer(
  env: Env,
  communityId: string,
  owner: string,
  to: string,
): Promise<boolean> {
  // The old owner steps down first: the index allows one owner at a time.
  const [, promoted] = await db(env).batch([
    db(env)
      .prepare(
        `UPDATE community_members SET role = 'moderator'
          WHERE community_id = ?1 AND account_id = ?2 AND role = 'owner'
            AND EXISTS (SELECT 1 FROM community_members
                         WHERE community_id = ?1 AND account_id = ?3 AND role != 'owner')`,
      )
      .bind(communityId, owner, to),
    db(env)
      .prepare(
        `UPDATE community_members SET role = 'owner'
          WHERE community_id = ?1 AND account_id = ?2
            AND NOT EXISTS (SELECT 1 FROM community_members
                             WHERE community_id = ?1 AND role = 'owner')`,
      )
      .bind(communityId, to),
  ]);
  return (promoted?.meta.changes ?? 0) > 0;
}
