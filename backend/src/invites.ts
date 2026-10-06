import ids from "../../identifiers/ids.json" with { type: "json" };
import { randomToken, tokenHash } from "./accounts.ts";
import { db } from "./env/index.ts";

// Invites (decisions 0009, 0019). D1 keeps only a token's hash, so a link can
// be shown once, when it is made, and never again.

/** The invite link for a token: `https://spjall.samtak.is/l/{token}`. */
export function inviteLink(token: string): string {
  return `https://${ids.hosts.link}${ids.hosts.linkPathPrefix}${token}`;
}

/**
 * A new personal invite for the account. Its old one, if any, is revoked in
 * the same batch, so the account never has two live links.
 */
export async function rotateInvite(env: Env, accountId: string): Promise<string> {
  const token = randomToken("");
  const now = Date.now();
  await db(env).batch([
    db(env)
      .prepare(
        "UPDATE invites SET revoked_at = ? WHERE inviter_account_id = ? AND revoked_at IS NULL",
      )
      .bind(now, accountId),
    db(env)
      .prepare(
        "INSERT INTO invites (token_hash, inviter_account_id, single_use, created_at) VALUES (?, ?, 0, ?)",
      )
      .bind(await tokenHash(token), accountId, now),
  ]);
  return token;
}

/** Revokes the account's personal invite; it then has none. */
export async function revokeInvite(env: Env, accountId: string): Promise<void> {
  await db(env)
    .prepare(
      "UPDATE invites SET revoked_at = ? WHERE inviter_account_id = ? AND revoked_at IS NULL",
    )
    .bind(Date.now(), accountId)
    .run();
}

/** Who a live invite is from: null inviter for the operator's. */
export type Invite = { inviter: { name: string | null; verified: boolean } | null };

/** The live invite a token names, or null. */
export async function resolveInvite(env: Env, token: string): Promise<Invite | null> {
  const row = await db(env)
    .prepare(
      `SELECT i.inviter_account_id AS inviter, a.display_name AS name, a.verified AS verified
         FROM invites i LEFT JOIN accounts a ON a.account_id = i.inviter_account_id
        WHERE i.token_hash = ? AND i.revoked_at IS NULL`,
    )
    .bind(await tokenHash(token))
    .first<{ inviter: string | null; name: string | null; verified: number | null }>();
  if (!row) return null;
  return {
    inviter: row.inviter === null ? null : { name: row.name, verified: row.verified === 1 },
  };
}
