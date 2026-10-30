import { db } from "../env/index.ts";

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

export async function accountExists(env: Env, accountId: string): Promise<boolean> {
  const found = await db(env)
    .prepare("SELECT 1 FROM accounts WHERE account_id = ?")
    .bind(accountId)
    .first();
  return found !== null;
}

/**
 * The statement that blocks `target` for `blocker`; it writes nothing when there
 * is no such account. It goes in one batch with what a block ends (decision 0114).
 */
export function blocking(env: Env, blocker: string, target: string): D1PreparedStatement {
  return db(env)
    .prepare(
      `INSERT INTO blocks (blocker_account_id, blocked_account_id, created_at)
       SELECT ?, account_id, ? FROM accounts WHERE account_id = ?
       ON CONFLICT DO NOTHING`,
    )
    .bind(blocker, Date.now(), target);
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

/** Every account a block stands between `viewer` and, in either direction (decision 0063). */
export async function blockedEither(env: Env, viewer: string): Promise<string[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT blocked_account_id AS accountId FROM blocks WHERE blocker_account_id = ?1
       UNION SELECT blocker_account_id FROM blocks WHERE blocked_account_id = ?1`,
    )
    .bind(viewer)
    .all<{ accountId: string }>();
  return results.map((r) => r.accountId);
}

/** The accounts among `accounts` that have blocked `account`. */
export async function blockersAmong(
  env: Env,
  account: string,
  accounts: string[],
): Promise<string[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT blocker_account_id AS accountId FROM blocks WHERE blocked_account_id = ?
          AND blocker_account_id IN (SELECT value FROM json_each(?))`,
    )
    .bind(account, JSON.stringify(accounts))
    .all<{ accountId: string }>();
  return results.map((r) => r.accountId);
}

/** Whether any of `accounts` has blocked `account`. */
export async function blockedByAny(
  env: Env,
  account: string,
  accounts: string[],
): Promise<boolean> {
  return (await blockersAmong(env, account, accounts)).length > 0;
}
