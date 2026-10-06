import { base64url } from "./bytes.ts";
import { db, kennitalaKey } from "./env/index.ts";
import type { Person } from "./identity.ts";

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

/** A fresh random id or token: `prefix` and 32 random bytes, base64url. */
export function randomToken(prefix: string): string {
  return `${prefix}${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

/**
 * HMAC-SHA256 of a kennitala under the Worker secret, hex: the only form a
 * kennitala is kept in (decisions 0014, 0019). Equal for the same person, so it
 * finds their account; useless without the key.
 */
async function kennitalaHmac(env: Env, nationalId: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(kennitalaKey(env)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(nationalId));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type NewDevice = {
  platform: "android" | "ios";
  deviceKey: Uint8Array;
  inviteToken: string | undefined;
};

/**
 * Gives the person a new device: on their account if the kennitala HMAC has
 * one, else on a new account, which needs a live invite (decision 0019).
 * Returns null when there is no account and no live invite.
 */
export async function registerDevice(
  env: Env,
  person: Person,
  device: NewDevice,
): Promise<{ accountId: string; deviceId: string; token: string } | null> {
  const hmac = await kennitalaHmac(env, person.nationalId);
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

  const existing = () =>
    db(env)
      .prepare("SELECT account_id AS accountId FROM accounts WHERE kennitala_hmac = ?")
      .bind(hmac)
      .first<{ accountId: string }>();

  const known = await existing();
  if (known) {
    await insertDevice(known.accountId).run();
    return { accountId: known.accountId, deviceId, token };
  }
  if (!device.inviteToken) return null;

  // One transaction: the account is written only if the invite is live, a
  // single-use invite is spent by it, and the device's foreign key fails the
  // whole batch when no account was written. So an invite that dies between
  // the read and the write lets nobody in.
  const accountId = randomToken("a_");
  const invite = await tokenHash(device.inviteToken);
  try {
    await db(env).batch([
      db(env)
        .prepare(
          `INSERT INTO accounts (account_id, display_name, verified, kennitala_hmac, created_at, invited_by)
           SELECT ?, ?, 1, ?, ?, inviter_account_id
             FROM invites WHERE token_hash = ? AND revoked_at IS NULL`,
        )
        .bind(accountId, person.name, hmac, now, invite),
      db(env)
        .prepare(
          "UPDATE invites SET revoked_at = ? WHERE token_hash = ? AND single_use = 1 AND revoked_at IS NULL",
        )
        .bind(now, invite),
      insertDevice(accountId),
    ]);
  } catch (error) {
    // The same person signing in twice at once: the other request made the
    // account, so this device joins it.
    const raced = await existing();
    if (raced) {
      await insertDevice(raced.accountId).run();
      return { accountId: raced.accountId, deviceId, token };
    }
    if (String(error).includes("FOREIGN KEY")) return null;
    throw error;
  }
  return { accountId, deviceId, token };
}
