import type { Framing } from "../api/image-frames.ts";
import { base64url } from "../shared/bytes.ts";
import { db, kennitalaKeys, type ProviderName } from "../env/index.ts";
import type { Person } from "./providers.ts";
import type { Platform } from "../shared/platforms.ts";
import { phoneSession } from "./sessions.ts";
import { type Suspension, suspensionRead } from "./suspension.ts";

// Accounts and devices in D1 (decision 0014).

/** The device a request acts as, once its token is checked. */
export type Device = { accountId: string; deviceId: string };

/** Hex SHA-256 of a device token: what D1 keeps instead of the token. */
export async function tokenHash(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
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

/** Each account with the devices the server still serves, in the order given (decision 0028). */
export async function activeDevicesOf(
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

/** Where a push to a device goes: its platform and token, if it has one. */
export type PushTarget = { platform: string; token: string | null; sandbox: number };

/** The push target of a device that is not revoked. */
export function pushTarget(database: D1Database, deviceId: string): Promise<PushTarget | null> {
  return database
    .prepare(
      `SELECT platform, push_token AS token, push_sandbox AS sandbox
         FROM devices WHERE device_id = ? AND revoked_at IS NULL`,
    )
    .bind(deviceId)
    .first<PushTarget>();
}

/** Clears a token a provider called dead, unless the device has a new one by now. */
export async function dropDeadPushToken(
  database: D1Database,
  deviceId: string,
  token: string,
): Promise<void> {
  await database
    .prepare("UPDATE devices SET push_token = NULL WHERE device_id = ? AND push_token = ?")
    .bind(deviceId, token)
    .run();
}

/** What a wall shows of `accountId`, or null when there is no such account (decision 0115). */
export async function accountProfile(
  env: Env,
  accountId: string,
): Promise<{ bio: string | null; createdAt: number } | null> {
  return db(env)
    .prepare("SELECT bio, created_at AS createdAt FROM accounts WHERE account_id = ?")
    .bind(accountId)
    .first<{ bio: string | null; createdAt: number }>();
}

/** Sets or clears the account's bio, with `entries` in the same write (decision 0115). */
export async function setBio(
  env: Env,
  accountId: string,
  bio: string | null,
  entries: D1PreparedStatement[] = [],
): Promise<void> {
  await db(env).batch([
    db(env).prepare("UPDATE accounts SET bio = ? WHERE account_id = ?").bind(bio, accountId),
    ...entries,
  ]);
}

/** Whether the account takes part in friend suggestions (decision 0114); true for one not set. */
export async function inSuggestions(env: Env, accountId: string): Promise<boolean> {
  const row = await db(env)
    .prepare("SELECT in_suggestions AS included FROM accounts WHERE account_id = ?")
    .bind(accountId)
    .first<{ included: number }>();
  return row?.included !== 0;
}

/** Takes the account into or out of friend suggestions, both ways (decision 0114). */
export async function setInSuggestions(
  env: Env,
  accountId: string,
  included: boolean,
): Promise<void> {
  await db(env)
    .prepare("UPDATE accounts SET in_suggestions = ? WHERE account_id = ?")
    .bind(included ? 1 : 0, accountId)
    .run();
}

/**
 * Sets or clears the account's photo version and framing (decisions 0039, 0086), with `entries` in
 * the same write. False when the account no longer exists.
 */
export async function setPhotoVersion(
  env: Env,
  accountId: string,
  version: string | null,
  framing: Framing | null,
  entries: D1PreparedStatement[] = [],
): Promise<boolean> {
  const [updated] = await db(env).batch([
    db(env)
      .prepare("UPDATE accounts SET photo_version = ?, photo_frames = ? WHERE account_id = ?")
      .bind(version, framing && JSON.stringify(framing), accountId),
    ...entries,
  ]);
  return (updated?.meta.changes ?? 0) > 0;
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
export async function subjectHmacs(env: Env, person: Person) {
  const keys = kennitalaKeys(env);
  const input = person.provider === "kenni" ? person.subject : `google:${person.subject}`;
  const hmac = await hmacHex(keys.key, input);
  const old = keys.previous ? await hmacHex(keys.previous, input) : hmac;
  return { hmac, old };
}

export type Hmacs = Awaited<ReturnType<typeof subjectHmacs>>;

/**
 * The account that holds this identity, under either key. A Kenni identity
 * is also looked up in accounts.kennitala_hmac, which old code still wrote
 * between migration 0008 and the deploy after it.
 */
export function holder(env: Env, provider: ProviderName, { hmac, old }: Hmacs) {
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
export function holdIdentity(
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
  platform: Platform;
  deviceKey: Uint8Array;
  inviteToken: string | undefined;
};

/**
 * Signs the person in (decision 0033: no invite needed): to the account that
 * holds their identity, else to a new one. A Kenni sign-in makes a verified
 * account, a Google one an unverified account with Google's name. A live
 * invite, when given, is recorded as `invited_by` and spent if single-use.
 * What the sign-in leaves on the account, a phone's session and device or a
 * browser's session (decision 0061), is written in the same transaction.
 */
export async function enrol(
  env: Env,
  person: Person,
  inviteToken: string | undefined,
  leave: (accountId: string, now: number) => D1PreparedStatement[],
): Promise<string> {
  const hmacs = await subjectHmacs(env, person);
  const now = Date.now();
  const known = await holder(env, person.provider, hmacs);
  if (known) {
    await db(env).batch([
      ...holdIdentity(env, known.accountId, person.provider, hmacs, now),
      ...leave(known.accountId, now),
    ]);
    return known.accountId;
  }

  // One transaction: the account, its identity and what the sign-in leaves.
  // The identity's primary key fails the whole batch when the same person
  // signed in at the same moment, and this sign-in then joins the account
  // that request made.
  const accountId = randomToken("a_");
  const kenni = person.provider === "kenni";
  const invite = inviteToken ? await tokenHash(inviteToken) : null;
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
      ...leave(accountId, now),
    ]);
  } catch (error) {
    const raced = await holder(env, person.provider, hmacs);
    if (!raced) throw error;
    await db(env).batch(leave(raced.accountId, now));
    return raced.accountId;
  }
  return accountId;
}

/**
 * Gives the person a new device, and the session it is enrolled from
 * (decision 0061). Refuses a device key some device already has; migration
 * 0003's index holds that under a race too.
 */
export async function registerDevice(
  env: Env,
  person: Person,
  device: NewDevice,
): Promise<
  | { ok: { accountId: string; deviceId: string; sessionId: string; token: string } }
  | { error: "device_key_taken" }
> {
  const taken = await db(env)
    .prepare("SELECT 1 FROM devices WHERE device_key = ?")
    .bind(device.deviceKey)
    .first();
  if (taken) return { error: "device_key_taken" };

  const deviceId = randomToken("d_");
  const token = randomToken("dt_");
  const hash = await tokenHash(token);
  const sessionId = randomToken("s_");
  const accountId = await enrol(env, person, device.inviteToken, (account, now) => [
    phoneSession(env, { sessionId, accountId: account, kind: device.platform }, now),
    db(env)
      .prepare(
        `INSERT INTO devices (device_id, account_id, platform, device_key, token_hash, created_at, session_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(deviceId, account, device.platform, device.deviceKey, hash, now, sessionId),
  ]);
  return { ok: { accountId, deviceId, sessionId, token } };
}

/**
 * The accounts that hold no identity, which no sign-in can reach: a join
 * whose deletion failed part way (decision 0035). Every account is made with
 * an identity in one transaction, and none loses its last otherwise.
 */
export async function orphans(env: Env): Promise<string[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT account_id AS accountId FROM accounts a
        WHERE NOT EXISTS (SELECT 1 FROM identities i WHERE i.account_id = a.account_id)
          AND a.kennitala_hmac IS NULL AND a.kind = 'person'`,
    )
    .all<{ accountId: string }>();
  return results.map((r) => r.accountId);
}

/**
 * The account as its owner sees it: name, mark, photo version, active devices, a
 * suspension that stands now, and whether it is one of the platform's moderators.
 */
export async function me(env: Env, accountId: string) {
  const [account, devices, suspended, moderator] = await db(env).batch<Record<string, unknown>>([
    db(env)
      .prepare(
        "SELECT display_name AS name, verified, photo_version AS photo FROM accounts WHERE account_id = ?",
      )
      .bind(accountId),
    db(env)
      .prepare(
        `SELECT device_id AS deviceId, platform, kind, created_at AS createdAt FROM devices
          WHERE account_id = ? AND revoked_at IS NULL ORDER BY created_at, device_id`,
      )
      .bind(accountId),
    suspensionRead(env, accountId),
    db(env).prepare("SELECT 1 FROM platform_moderators WHERE account_id = ?").bind(accountId),
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
      platform: Platform;
      kind: "phone" | "web";
      createdAt: number;
    }[],
    suspension: (suspended?.results[0] as Suspension | undefined) ?? null,
    platformModerator: (moderator?.results.length ?? 0) > 0,
  };
}

/**
 * Revokes one device of this account, so its token fails at once, and drops
 * its KeyPackages so no one adds it to a group again (decision 0019). A
 * phone's session ends with its device; the session of a browser it was
 * linked from does not (decision 0061), and the server's store-key share is
 * wiped first (decision 0064). A device already revoked is revoked again,
 * keeping its time, so a revoke that failed after this step can be retried.
 * False when the account has no such device.
 */
export async function revokeDevice(
  env: Env,
  accountId: string,
  deviceId: string,
): Promise<boolean> {
  const [, revoked] = await db(env).batch([
    db(env)
      .prepare(
        `DELETE FROM sessions WHERE kind != 'web' AND session_id IN
         (SELECT session_id FROM devices WHERE device_id = ? AND account_id = ?)`,
      )
      .bind(deviceId, accountId),
    db(env)
      .prepare(
        `UPDATE devices
            SET revoked_at = coalesce(revoked_at, ?), push_token = NULL, store_key_share = NULL
          WHERE device_id = ? AND account_id = ?`,
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
 * The first step of deleting an account (`deleteAccount`): its tokens and
 * sessions die, so nothing acts as the account while the rest goes.
 */
export async function revokeAllDevices(env: Env, accountId: string): Promise<void> {
  await db(env).batch([
    db(env)
      .prepare(
        `UPDATE devices SET revoked_at = ?, push_token = NULL, store_key_share = NULL
          WHERE account_id = ? AND revoked_at IS NULL`,
      )
      .bind(Date.now(), accountId),
    db(env).prepare("DELETE FROM sessions WHERE account_id = ?").bind(accountId),
  ]);
}

/**
 * The last step of deleting an account. Devices, KeyPackages, invites, roster
 * copies and blocks cascade; invited_by elsewhere goes null.
 */
export async function dropAccount(env: Env, accountId: string): Promise<void> {
  await db(env).prepare("DELETE FROM accounts WHERE account_id = ?").bind(accountId).run();
}
