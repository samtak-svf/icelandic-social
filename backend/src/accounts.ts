import { base64url } from "./bytes.ts";
import { conversation, db, inbox, kennitalaKeys, type ProviderName } from "./env/index.ts";
import type { Person } from "./identity.ts";
import { deleteAccountMedia } from "./media.ts";
import { deleteAccountPhoto } from "./photos.ts";

// Accounts and devices in D1 (decision 0014).

/** The device a request acts as, once its token is checked. */
export type Device = { accountId: string; deviceId: string };

/** Hex SHA-256 of a device token: what D1 keeps instead of the token. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The active device that holds this token, or null. */
export async function deviceForToken(env: Env, token: string): Promise<Device | null> {
  return db(env)
    .prepare(
      `SELECT account_id AS accountId, device_id AS deviceId
         FROM devices WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .bind(await tokenHash(token))
    .first<Device>();
}

/** The ids of an account's devices that are not revoked. */
export async function activeDevices(env: Env, accountId: string): Promise<string[]> {
  const { results } = await db(env)
    .prepare(
      "SELECT device_id AS deviceId FROM devices WHERE account_id = ? AND revoked_at IS NULL",
    )
    .bind(accountId)
    .all<{ deviceId: string }>();
  return results.map((r) => r.deviceId);
}

/**
 * Sets this device's push token (decision 0025). A token is one device's at
 * a time: registering it here takes it from any other device that had it.
 */
export async function setPushToken(
  env: Env,
  deviceId: string,
  token: string,
  sandbox: boolean,
): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare("UPDATE devices SET push_token = NULL WHERE push_token = ? AND device_id != ?")
      .bind(token, deviceId),
    db(env)
      .prepare(
        "UPDATE devices SET push_token = ?, push_sandbox = ? WHERE device_id = ? AND revoked_at IS NULL",
      )
      .bind(token, sandbox ? 1 : 0, deviceId),
  ]);
}

/** Removes this device's push token, so nothing is pushed to it. */
export async function clearPushToken(env: Env, deviceId: string): Promise<void> {
  await db(env)
    .prepare("UPDATE devices SET push_token = NULL, push_sandbox = 0 WHERE device_id = ?")
    .bind(deviceId)
    .run();
}

/** A fresh random id or token: `prefix` and 32 random bytes, base64url. */
export function randomToken(prefix: string): string {
  return `${prefix}${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/**
 * HMAC-SHA256 under a Worker secret, hex: the only form a kennitala or a
 * Google subject is kept in (decisions 0014, 0019, 0033). Equal for the same
 * person, so it finds their account; useless without the key.
 */
async function hmacHex(secret: string, input: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(input));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The person's subject HMAC under the current key, and under the previous
 * one while a rotation runs (else the same). A Kenni subject is the bare
 * kennitala, so rows from before decision 0033 still match; a Google one is
 * prefixed, so the two can never collide.
 */
async function subjectHmacs(env: Env, person: Person) {
  const keys = kennitalaKeys(env);
  const input = person.provider === "kenni" ? person.subject : `google:${person.subject}`;
  const hmac = await hmacHex(keys.key, input);
  const old = keys.previous ? await hmacHex(keys.previous, input) : hmac;
  return { hmac, old };
}

type Hmacs = Awaited<ReturnType<typeof subjectHmacs>>;

/**
 * The account that holds this identity, under either key. A Kenni identity
 * is also looked up in accounts.kennitala_hmac, which old code still wrote
 * between migration 0008 and the deploy after it.
 */
function holder(env: Env, provider: ProviderName, { hmac, old }: Hmacs) {
  const legacy =
    provider === "kenni"
      ? " UNION ALL SELECT account_id FROM accounts WHERE kennitala_hmac IN (?2, ?3)"
      : "";
  return db(env)
    .prepare(
      `SELECT account_id AS accountId FROM identities
        WHERE provider = ?1 AND subject_hmac IN (?2, ?3)${legacy} LIMIT 1`,
    )
    .bind(provider, hmac, old)
    .first<{ accountId: string }>();
}

/**
 * Writes the identity under the current key for this account, replacing a
 * row under the previous key, so a rotation completes as people sign in. A
 * Kenni identity is written to accounts.kennitala_hmac as well, so the code
 * before decision 0033 still finds it if a deploy is rolled back.
 */
function holdIdentity(
  env: Env,
  accountId: string,
  provider: ProviderName,
  { hmac, old }: Hmacs,
  now: number,
  orIgnore: "OR IGNORE" | "" = "OR IGNORE",
) {
  const statements = [
    db(env)
      .prepare(
        "DELETE FROM identities WHERE provider = ? AND subject_hmac = ? AND subject_hmac != ? AND account_id = ?",
      )
      .bind(provider, old, hmac, accountId),
    db(env)
      .prepare(
        `INSERT ${orIgnore} INTO identities (provider, subject_hmac, account_id, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(provider, hmac, accountId, now),
  ];
  if (provider === "kenni") {
    statements.push(
      db(env)
        .prepare("UPDATE accounts SET kennitala_hmac = ? WHERE account_id = ?")
        .bind(hmac, accountId),
    );
  }
  return statements;
}

export type NewDevice = {
  platform: "android" | "ios";
  deviceKey: Uint8Array;
  inviteToken: string | undefined;
};

/**
 * Gives the person a new device: on the account that holds their identity,
 * else on a new account (decision 0033: no invite needed). A Kenni sign-in
 * makes a verified account, a Google one an unverified account with Google's
 * name. A live invite, when given, is recorded as `invited_by` and spent if
 * single-use. Refuses a device key some device already has; migration
 * 0003's index holds that under a race too.
 */
export async function registerDevice(
  env: Env,
  person: Person,
  device: NewDevice,
): Promise<
  { ok: { accountId: string; deviceId: string; token: string } } | { error: "device_key_taken" }
> {
  const taken = await db(env)
    .prepare("SELECT 1 FROM devices WHERE device_key = ?")
    .bind(device.deviceKey)
    .first();
  if (taken) return { error: "device_key_taken" };

  const hmacs = await subjectHmacs(env, person);
  const deviceId = randomToken("d_");
  const token = randomToken("dt_");
  const hash = await tokenHash(token);
  const now = Date.now();
  const insertDevice = (accountId: string) =>
    db(env)
      .prepare(
        `INSERT INTO devices (device_id, account_id, platform, device_key, token_hash, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(deviceId, accountId, device.platform, device.deviceKey, hash, now);

  const known = await holder(env, person.provider, hmacs);
  if (known) {
    await db(env).batch([
      ...holdIdentity(env, known.accountId, person.provider, hmacs, now),
      insertDevice(known.accountId),
    ]);
    return { ok: { accountId: known.accountId, deviceId, token } };
  }

  // One transaction: the account, its identity and its device. The identity's
  // primary key fails the whole batch when the same person signed in at the
  // same moment, and this device then joins the account that request made.
  const accountId = randomToken("a_");
  const kenni = person.provider === "kenni";
  const invite = device.inviteToken ? await tokenHash(device.inviteToken) : null;
  try {
    await db(env).batch([
      db(env)
        .prepare(
          `INSERT INTO accounts (account_id, display_name, verified, kennitala_hmac, created_at, invited_by)
           VALUES (?, ?, ?, ?, ?,
             (SELECT inviter_account_id FROM invites WHERE token_hash = ? AND revoked_at IS NULL))`,
        )
        .bind(accountId, person.name, kenni ? 1 : 0, kenni ? hmacs.hmac : null, now, invite),
      db(env)
        .prepare(
          "UPDATE invites SET revoked_at = ? WHERE token_hash = ? AND single_use = 1 AND revoked_at IS NULL",
        )
        .bind(now, invite),
      ...holdIdentity(env, accountId, person.provider, hmacs, now, ""),
      insertDevice(accountId),
    ]);
  } catch (error) {
    const raced = await holder(env, person.provider, hmacs);
    if (!raced) throw error;
    await insertDevice(raced.accountId).run();
    return { ok: { accountId: raced.accountId, deviceId, token } };
  }
  return { ok: { accountId, deviceId, token } };
}

/** What linking did: the account the calling device now belongs to. */
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
  device: Device,
  person: Person,
  { merge = false } = {},
): Promise<{ ok: Linked } | { error: "identity_taken" | "already_linked" }> {
  const { accountId } = device;
  const hmacs = await subjectHmacs(env, person);
  const owner = await holder(env, person.provider, hmacs);
  if (owner && owner.accountId !== accountId) {
    if (merge && (await mergeable(env, accountId, owner.accountId, person.provider))) {
      await mergeInto(env, device, owner.accountId, person, hmacs);
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
 * Joins the calling account into `into` (decision 0035). One transaction
 * moves the Google identity, the calling device with its token, and the
 * blocks; then the calling account is deleted
 * as DELETE /v1/me deletes one. If that fails part way, the account is left
 * without an identity, and the daily cron finishes it (`deleteOrphans`).
 */
async function mergeInto(
  env: Env,
  { accountId: from, deviceId }: Device,
  into: string,
  person: Person,
  hmacs: Hmacs,
) {
  const move = (sql: string) => db(env).prepare(sql).bind(into, from);
  await db(env).batch([
    move("UPDATE identities SET account_id = ? WHERE account_id = ? AND provider = 'google'"),
    db(env)
      .prepare("UPDATE devices SET account_id = ? WHERE device_id = ? AND account_id = ?")
      .bind(into, deviceId, from),
    // Their credentials name the account the device leaves.
    db(env).prepare("DELETE FROM key_packages WHERE device_id = ?").bind(deviceId),
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
  await deleteAccount(env, from);
}

/**
 * Deletes the accounts that hold no identity, which no sign-in can reach: a
 * join whose deletion failed part way (decision 0035). Every account is made
 * with an identity in one transaction, and none loses its last otherwise.
 */
export async function deleteOrphans(env: Env): Promise<number> {
  const { results } = await db(env)
    .prepare(
      `SELECT account_id AS accountId FROM accounts a
        WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.account_id = a.account_id)
          AND a.kennitala_hmac IS NULL`,
    )
    .all<{ accountId: string }>();
  for (const { accountId } of results) await deleteAccount(env, accountId);
  return results.length;
}

/** The account as its owner sees it: name, mark, photo version and active devices. */
export async function me(env: Env, accountId: string) {
  const [account, devices] = await db(env).batch<Record<string, unknown>>([
    db(env)
      .prepare(
        "SELECT display_name AS name, verified, photo_version AS photo FROM accounts WHERE account_id = ?",
      )
      .bind(accountId),
    db(env)
      .prepare(
        `SELECT device_id AS deviceId, platform, created_at AS createdAt FROM devices
          WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at, device_id`,
      )
      .bind(accountId),
  ]);
  const row = account?.results[0] as
    | { name: string | null; verified: number; photo: string | null }
    | undefined;
  return {
    name: row?.name ?? null,
    verified: row?.verified === 1,
    photo: row?.photo ?? null,
    devices: (devices?.results ?? []) as {
      deviceId: string;
      platform: "android" | "ios";
      createdAt: number;
    }[],
  };
}

/**
 * Revokes one active device of this account, so its token fails at once, and
 * drops its KeyPackages so no one adds it to a group again (decision 0019).
 * False when the account has no such active device.
 */
export async function revokeDevice(
  env: Env,
  accountId: string,
  deviceId: string,
): Promise<boolean> {
  const [revoked] = await db(env).batch([
    db(env)
      .prepare(
        `UPDATE devices SET revoked_at = ?, push_token = NULL
         WHERE device_id = ? AND account_id = ? AND revoked_at IS NULL`,
      )
      .bind(Date.now(), deviceId, accountId),
    db(env)
      .prepare(
        `DELETE FROM key_packages WHERE device_id IN
         (SELECT device_id FROM devices WHERE device_id = ? AND account_id = ?)`,
      )
      .bind(deviceId, accountId),
  ]);
  return (revoked?.meta.changes ?? 0) > 0;
}

/**
 * Deletes an account in decision 0014's order (0019 spells it out). The
 * tokens die first, so nothing acts as the account while the rest goes. A
 * failure part way leaves an account with no devices; signing in again lands
 * on it, and a second delete finishes the job.
 */
export async function deleteAccount(env: Env, accountId: string): Promise<void> {
  await db(env)
    .prepare(
      "UPDATE devices SET revoked_at = ?, push_token = NULL WHERE account_id = ? AND revoked_at IS NULL",
    )
    .bind(Date.now(), accountId)
    .run();
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
  // Devices, KeyPackages, invites, roster copies and blocks cascade;
  // invited_by elsewhere goes null.
  await db(env).prepare("DELETE FROM accounts WHERE account_id = ?").bind(accountId).run();
}
