import { db } from "../../env/index.ts";

// What waits for a moderator or for the invited: the join requests (decision 0063) and
// the invitations a community has sent (decision 0130), and whether one still stands.

export type Invitation = {
  accountId: string;
  name: string | null;
  invitedBy: { accountId: string; name: string | null } | null;
  createdAt: number;
};

/** The invitations that wait, newest first; a moderator sees who sent each (decision 0130). */
export async function invitations(env: Env, communityId: string): Promise<Invitation[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT i.account_id AS accountId, a.display_name AS name, i.created_at AS createdAt,
              i.invited_by AS byId, b.display_name AS byName
         FROM community_invitations i
         JOIN accounts a ON a.account_id = i.account_id
         LEFT JOIN accounts b ON b.account_id = i.invited_by
        WHERE i.community_id = ?
        ORDER BY i.created_at DESC, i.account_id`,
    )
    .bind(communityId)
    .all<{
      accountId: string;
      name: string | null;
      createdAt: number;
      byId: string | null;
      byName: string | null;
    }>();
  return results.map((r) => ({
    accountId: r.accountId,
    name: r.name,
    createdAt: r.createdAt,
    invitedBy: r.byId === null ? null : { accountId: r.byId, name: r.byName },
  }));
}

/** Whether `accountId` is invited to the live community and not yet a member (decision 0130). */
export async function invitationStands(
  env: Env,
  communityId: string,
  accountId: string,
): Promise<boolean> {
  const row = await db(env)
    .prepare(
      `SELECT 1 AS stands FROM community_invitations i
         JOIN live_communities c ON c.community_id = i.community_id
        WHERE i.community_id = ?1 AND i.account_id = ?2
          AND NOT EXISTS (SELECT 1 FROM community_members m
                           WHERE m.community_id = ?1 AND m.account_id = ?2)`,
    )
    .bind(communityId, accountId)
    .first();
  return row !== null;
}

export type JoinRequest = {
  accountId: string;
  name: string | null;
  verified: boolean;
  requestedAt: number;
};

/** The join requests that wait, oldest first; a moderator sees them whoever made them. */
export async function joinRequests(env: Env, communityId: string): Promise<JoinRequest[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT r.account_id AS accountId, a.display_name AS name, a.verified,
              r.created_at AS requestedAt
         FROM community_join_requests r JOIN accounts a ON a.account_id = r.account_id
        WHERE r.community_id = ? AND r.declined_at IS NULL
        ORDER BY r.created_at, r.account_id`,
    )
    .bind(communityId)
    .all<Omit<JoinRequest, "verified"> & { verified: number }>();
  return results.map((r) => ({ ...r, verified: r.verified === 1 }));
}
