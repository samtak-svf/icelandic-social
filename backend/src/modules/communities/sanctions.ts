import { db } from "../../env/index.ts";

// What a moderator does to a member (decision 0063): mute, remove, ban and
// lift a ban. Each takes the moderation log's entries and writes them in the
// same batch, so an action is never without its entry (decision 0066). None
// reaches the owner.

export type Sanction =
  | { action: "mute"; until: number }
  | { action: "unmute" | "remove" | "ban" | "unban" };

/**
 * Applies `what` to `accountId`, with `entries` in the same batch. The
 * caller has checked the account stands where the sanction needs it to.
 */
export async function sanction(
  env: Env,
  communityId: string,
  accountId: string,
  what: Sanction,
  entries: D1PreparedStatement[],
): Promise<void> {
  await db(env).batch([...statements(env, communityId, accountId, what), ...entries]);
}

function statements(
  env: Env,
  communityId: string,
  accountId: string,
  s: Sanction,
): D1PreparedStatement[] {
  const bound = (sql: string, ...more: unknown[]) =>
    db(env)
      .prepare(sql)
      .bind(...more, communityId, accountId);
  const member = "community_id = ? AND account_id = ?";
  switch (s.action) {
    case "mute":
      return [
        bound(
          `UPDATE community_members SET muted_until = ? WHERE ${member} AND role != 'owner'`,
          s.until,
        ),
      ];
    case "unmute":
      return [bound(`UPDATE community_members SET muted_until = NULL WHERE ${member}`)];
    case "remove":
      return [bound(`DELETE FROM community_members WHERE ${member} AND role != 'owner'`)];
    case "ban":
      return [
        db(env)
          .prepare(
            `INSERT OR IGNORE INTO community_bans (community_id, account_id, created_at)
             SELECT ?1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM community_members
                WHERE community_id = ?1 AND account_id = ?2 AND role = 'owner')`,
          )
          .bind(communityId, accountId, Date.now()),
        bound(`DELETE FROM community_members WHERE ${member}`),
        bound(`DELETE FROM community_join_requests WHERE ${member}`),
        bound(`DELETE FROM community_invitations WHERE ${member}`),
      ];
    case "unban":
      return [bound(`DELETE FROM community_bans WHERE ${member}`)];
  }
}
