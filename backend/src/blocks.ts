import { db } from "./env/index.ts";

// Block (decision 0024): one account blocking another. The server refuses
// new contact from the blocked account; the blocker's core does the rest.

/**
 * SQL: neither of two accounts, each a column or a parameter, has blocked the
 * other. A photo is withheld both ways (decision 0039).
 */
export const UNBLOCKED = (one: string, other: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks
     WHERE (blocker_account_id = ${one} AND blocked_account_id = ${other})
        OR (blocker_account_id = ${other} AND blocked_account_id = ${one}))`;

/** Blocks `target` for `blocker`; false when there is no such account. */
export async function block(env: Env, blocker: string, target: string): Promise<boolean> {
  const result = await db(env)
    .prepare(
      `INSERT INTO blocks (blocker_account_id, blocked_account_id, created_at)
       SELECT ?, account_id, ? FROM accounts WHERE account_id = ?
       ON CONFLICT DO NOTHING`,
    )
    .bind(blocker, Date.now(), target)
    .run();
  if (result.meta.changes > 0) return true;
  return (
    (await db(env).prepare("SELECT 1 FROM accounts WHERE account_id = ?").bind(target).first()) !==
    null
  );
}

/** Lifts a block; lifting one that is not there is no error. */
export async function unblock(env: Env, blocker: string, target: string): Promise<void> {
  await db(env)
    .prepare("DELETE FROM blocks WHERE blocker_account_id = ? AND blocked_account_id = ?")
    .bind(blocker, target)
    .run();
}

export type Blocked = {
  accountId: string;
  name: string | null;
  verified: boolean;
  blockedAt: number;
};

/** The accounts `blocker` has blocked, newest first. */
export async function blockList(env: Env, blocker: string): Promise<Blocked[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT b.blocked_account_id AS accountId, a.display_name AS name, a.verified,
              b.created_at AS blockedAt
         FROM blocks b JOIN accounts a ON a.account_id = b.blocked_account_id
        WHERE b.blocker_account_id = ? ORDER BY b.created_at DESC, b.blocked_account_id`,
    )
    .bind(blocker)
    .all<{ accountId: string; name: string | null; verified: number; blockedAt: number }>();
  return results.map((r) => ({ ...r, verified: r.verified === 1 }));
}

/** Whether any of `accounts` has blocked `account`. */
export async function blockedByAny(
  env: Env,
  account: string,
  accounts: string[],
): Promise<boolean> {
  if (!accounts.length) return false;
  const row = await db(env)
    .prepare(
      `SELECT 1 FROM blocks WHERE blocked_account_id = ?
          AND blocker_account_id IN (SELECT value FROM json_each(?)) LIMIT 1`,
    )
    .bind(account, JSON.stringify(accounts))
    .first();
  return row !== null;
}
