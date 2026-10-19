import { db, type ProviderName } from "../env/index.ts";
import { holder, holdIdentity, type Hmacs, subjectHmacs } from "./accounts.ts";
import type { Person } from "./providers.ts";

// Linking an identity to an account, and joining an account into the older
// one its kennitala holds (decisions 0033, 0035, 0069).

/**
 * Who links an identity: the session the request acts in, and the device when
 * a phone's token proved it (decision 0061). A browser has no device.
 */
export type Caller = { accountId: string; sessionId: string; deviceId?: string };

/** What linking did: the account the caller now belongs to. */
export type Linked = { accountId: string; merged: boolean };

/**
 * Links an identity to this account (decision 0033). Linking Kenni makes the
 * account verified and gives it the registry's name, when Kenni gave one.
 * Linking the identity the account already holds succeeds again. Refuses an
 * identity another account holds, and a second identity of one provider,
 * except that with `merge` a Kenni identity held by an account without
 * Google joins this one into it (decision 0035).
 */
export async function linkIdentity(
  env: Env,
  caller: Caller,
  person: Person,
  { merge = false } = {},
): Promise<{ ok: Linked } | { error: "identity_taken" | "already_linked" }> {
  const { accountId } = caller;
  const hmacs = await subjectHmacs(env, person);
  const owner = await holder(env, person.provider, hmacs);
  if (owner && owner.accountId !== accountId) {
    if (merge && (await mergeable(env, accountId, owner.accountId, person.provider))) {
      await mergeInto(env, caller, owner.accountId, person, hmacs);
      return { ok: { accountId: owner.accountId, merged: true } };
    }
    return { error: "identity_taken" };
  }
  const linked = { ok: { accountId, merged: false } };
  if (!owner) {
    const other = await db(env)
      .prepare("SELECT 1 FROM identities WHERE account_id = ? AND provider = ?")
      .bind(accountId, person.provider)
      .first();
    if (other) return { error: "already_linked" };
  }
  try {
    await db(env).batch([
      ...holdIdentity(env, accountId, person.provider, hmacs, Date.now(), owner ? "OR IGNORE" : ""),
      ...verify(env, accountId, person),
    ]);
  } catch (error) {
    // Another request linked this identity, or another of this provider,
    // between the read and the write.
    const raced = await holder(env, person.provider, hmacs);
    if (raced?.accountId === accountId) return linked;
    if (raced) return { error: "identity_taken" };
    if (String(error).includes("UNIQUE")) return { error: "already_linked" };
    throw error;
  }
  return linked;
}

/** Linking Kenni marks the account verified and gives it the registry's name. */
function verify(env: Env, accountId: string, person: Person) {
  if (person.provider !== "kenni") return [];
  return [
    db(env)
      .prepare(
        "UPDATE accounts SET verified = 1, display_name = COALESCE(?, display_name) WHERE account_id = ?",
      )
      .bind(person.name, accountId),
  ];
}

/**
 * Whether Kenni may join `from` into `into` (decision 0035): `from` holds
 * Google and no Kenni, and `into` holds no Google. Each then ends with one
 * identity per provider.
 */
async function mergeable(env: Env, from: string, into: string, provider: ProviderName) {
  if (provider !== "kenni") return false;
  const rows = await db(env)
    .prepare("SELECT account_id AS accountId, provider FROM identities WHERE account_id IN (?, ?)")
    .bind(from, into)
    .all<{ accountId: string; provider: ProviderName }>();
  const holds = (account: string, p: ProviderName) =>
    rows.results.some((r) => r.accountId === account && r.provider === p);
  return holds(from, "google") && !holds(from, "kenni") && !holds(into, "google");
}

/**
 * Joins the calling account into `into` (decisions 0035, 0069). One
 * transaction moves the Google identity, the calling session, the calling
 * device with its token when a phone calls, and the blocks; the caller then
 * deletes the calling account as DELETE /v1/me deletes one. If that fails part
 * way, the account is left without an identity, and the daily cron finishes it
 * (`deleteOrphans`).
 */
async function mergeInto(
  env: Env,
  { accountId: from, sessionId, deviceId }: Caller,
  into: string,
  person: Person,
  hmacs: Hmacs,
) {
  const move = (sql: string) => db(env).prepare(sql).bind(into, from);
  const device = deviceId
    ? [
        db(env)
          .prepare("UPDATE devices SET account_id = ? WHERE device_id = ? AND account_id = ?")
          .bind(into, deviceId, from),
        // Their credentials name the account the device leaves.
        db(env).prepare("DELETE FROM key_packages WHERE device_id = ?").bind(deviceId),
      ]
    : [];
  await db(env).batch([
    move("UPDATE identities SET account_id = ? WHERE account_id = ? AND provider = 'google'"),
    // The session goes along, so deleting the account it leaves does not end it.
    db(env)
      .prepare("UPDATE sessions SET account_id = ? WHERE session_id = ? AND account_id = ?")
      .bind(into, sessionId, from),
    ...device,
    db(env)
      .prepare(
        "UPDATE OR IGNORE blocks SET blocker_account_id = ?1 WHERE blocker_account_id = ?2 AND blocked_account_id != ?1",
      )
      .bind(into, from),
    db(env)
      .prepare(
        "UPDATE OR IGNORE blocks SET blocked_account_id = ?1 WHERE blocked_account_id = ?2 AND blocker_account_id != ?1",
      )
      .bind(into, from),
    ...holdIdentity(env, into, person.provider, hmacs, Date.now()),
    ...verify(env, into, person),
  ]);
}
