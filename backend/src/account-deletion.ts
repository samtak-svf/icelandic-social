import { conversation, db, inbox } from "./env/index.ts";
import { dropAccount, orphans, revokeAllDevices } from "./identity/index.ts";
import { deleteAccountMedia } from "./media.ts";
import { deleteAccountPhoto } from "./photos.ts";

// Deleting an account reaches every part of the Worker that keeps something
// of it, so it lives above them all and each part removes its own.

/**
 * Deletes an account in decision 0014's order (0019 spells it out). The
 * tokens die first, so nothing acts as the account while the rest goes. A
 * failure part way leaves an account with no devices; signing in again lands
 * on it, and a second delete finishes the job.
 */
export async function deleteAccount(env: Env, accountId: string): Promise<void> {
  await revokeAllDevices(env, accountId);
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
  await deleteAccountPhoto(env, accountId);
  await dropAccount(env, accountId);
}

/** Deletes the accounts no sign-in can reach (`orphans`, decision 0035). */
export async function deleteOrphans(env: Env): Promise<number> {
  const ids = await orphans(env);
  for (const accountId of ids) await deleteAccount(env, accountId);
  return ids.length;
}
