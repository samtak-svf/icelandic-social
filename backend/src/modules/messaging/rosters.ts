import { conversation, db, inbox } from "../../env/index.ts";
import { deleteAccountMedia } from "./media.ts";

// The copy of each conversation's roster in D1. The Conversation DO owns the
// roster; the copy tells account deletion which conversations to leave.

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

/**
 * Takes a deleted account out of every conversation it is in, then wipes its
 * inbox and its media (decision 0014).
 */
export async function leaveConversations(env: Env, accountId: string): Promise<void> {
  const box = inbox(env, accountId);
  // The inbox lists a conversation only once something was stored in it;
  // the roster copy also has those it was added to and never heard from.
  const { results: copied } = await db(env)
    .prepare("SELECT conversation_id AS id FROM conversation_members WHERE account_id = ?")
    .bind(accountId)
    .all<{ id: string }>();
  const conversations = new Set([...Object.keys(await box.latest()), ...copied.map((r) => r.id)]);
  await Promise.all([...conversations].map((id) => conversation(env, id).removeAccount(accountId)));
  await box.wipe();
  await deleteAccountMedia(env, accountId);
}
