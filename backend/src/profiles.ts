import { db } from "./env/index.ts";

// Names of other accounts (decision 0022). An account may read the name and
// mark of an account it shares a conversation with, and of no other. The
// Conversation DO owns the roster; D1 holds a copy of it to answer that.

/**
 * Copies a conversation's roster as of the commit at `seq` into D1, in one
 * batch that does nothing when D1 already holds a newer copy. Accounts that
 * no longer exist are left out, so a late copy cannot fail on them.
 */
export async function copyRoster(
  env: Env,
  conversationId: string,
  seq: number,
  accounts: string[],
): Promise<void> {
  const current = "(SELECT seq FROM conversation_rosters WHERE conversation_id = ?) = ?";
  await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO conversation_rosters (conversation_id, seq) VALUES (?, ?)
         ON CONFLICT (conversation_id) DO UPDATE SET seq = excluded.seq WHERE excluded.seq > seq`,
      )
      .bind(conversationId, seq),
    db(env)
      .prepare(`DELETE FROM conversation_members WHERE conversation_id = ? AND ${current}`)
      .bind(conversationId, conversationId, seq),
    db(env)
      .prepare(
        `INSERT INTO conversation_members (conversation_id, account_id)
         SELECT ?, account_id FROM accounts
          WHERE account_id IN (SELECT value FROM json_each(?)) AND ${current}`,
      )
      .bind(conversationId, JSON.stringify(accounts), conversationId, seq),
  ]);
}

/** Deletes the copy of a conversation that no longer exists. */
export async function dropRoster(env: Env, conversationId: string): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare("DELETE FROM conversation_members WHERE conversation_id = ?")
      .bind(conversationId),
    db(env)
      .prepare("DELETE FROM conversation_rosters WHERE conversation_id = ?")
      .bind(conversationId),
  ]);
}

/** Each account with the devices the server still serves, in the order given (decision 0028). */
export async function activeDevices(
  env: Env,
  accounts: string[],
): Promise<{ accountId: string; deviceIds: string[] }[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT account_id AS accountId, device_id AS deviceId FROM devices
        WHERE account_id IN (SELECT value FROM json_each(?)) AND revoked_at IS NULL
        ORDER BY device_id`,
    )
    .bind(JSON.stringify(accounts))
    .all<{ accountId: string; deviceId: string }>();
  return accounts.map((accountId) => ({
    accountId,
    deviceIds: results.filter((r) => r.accountId === accountId).map((r) => r.deviceId),
  }));
}

export type Profile = { accountId: string; name: string | null; verified: boolean };

/** The account as `reader` may see it: itself, or one it shares a conversation with. */
export async function profile(
  env: Env,
  reader: string,
  accountId: string,
): Promise<Profile | null> {
  const row = await db(env)
    .prepare(
      `SELECT display_name AS name, verified FROM accounts
        WHERE account_id = ?1 AND (?1 = ?2 OR EXISTS (
          SELECT 1 FROM conversation_members theirs
            JOIN conversation_members mine ON mine.conversation_id = theirs.conversation_id
           WHERE theirs.account_id = ?1 AND mine.account_id = ?2))`,
    )
    .bind(accountId, reader)
    .first<{ name: string | null; verified: number }>();
  return row ? { accountId, name: row.name, verified: row.verified === 1 } : null;
}
