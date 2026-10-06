import { db } from "./env/index.ts";

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
