import { dropAccount, orphans, revokeAllDevices } from "./identity/index.ts";
import { handOverCommunities } from "./modules/communities/index.ts";
import { deleteAccountHistory } from "./modules/history/index.ts";
import { leaveConversations } from "./modules/messaging/index.ts";
import { deleteAccountPhoto } from "./modules/profiles/index.ts";
import { forgetAccount } from "./modules/social/index.ts";

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
  await leaveConversations(env, accountId);
  await deleteAccountPhoto(env, accountId);
  // What it wrote in any space goes, and the communities it owns pass on;
  // its memberships go with its row (0063).
  await forgetAccount(env, accountId);
  await handOverCommunities(env, accountId);
  // A history transfer's row would go with the account, its bytes would not.
  await deleteAccountHistory(env, accountId);
  await dropAccount(env, accountId);
}

/** Deletes the accounts no sign-in can reach (`orphans`, decision 0035). */
export async function deleteOrphans(env: Env): Promise<number> {
  const ids = await orphans(env);
  for (const accountId of ids) await deleteAccount(env, accountId);
  return ids.length;
}
