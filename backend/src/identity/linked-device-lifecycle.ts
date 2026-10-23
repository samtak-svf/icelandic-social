import { db, inbox } from "../env/index.ts";
import type { Device } from "./accounts.ts";
import type { Session } from "./sessions.ts";

// The life of a linked non-phone device after enrolment (decisions 0064, 0081):
// the activity window, and which linked device a browser session stands for.

const DAY_MS = 24 * 60 * 60 * 1000;
/** A linked device is removed after 45 days without an authenticated request (decision 0064). */
export const LINKED_IDLE_MS = 45 * DAY_MS;

/**
 * Checks whether a linked non-phone device is still within its 45-day activity
 * window and updates `last_seen_at` at most once a day (decision 0064).
 */
export async function touchLinkedDevice(
  env: Env,
  deviceId: string,
  now = Date.now(),
): Promise<boolean> {
  const row = await db(env)
    .prepare("SELECT last_seen_at AS lastSeenAt FROM devices WHERE device_id = ?")
    .bind(deviceId)
    .first<{ lastSeenAt: number | null }>();
  if (!row) return false;
  if (row.lastSeenAt !== null && row.lastSeenAt + LINKED_IDLE_MS <= now) return false;
  if (row.lastSeenAt === null || now - row.lastSeenAt >= DAY_MS) {
    await db(env)
      .prepare("UPDATE devices SET last_seen_at = ? WHERE device_id = ?")
      .bind(now, deviceId)
      .run();
  }
  return true;
}

/**
 * The active linked browser device of a session, for a socket opened with the
 * session cookie (decision 0081), or null when it has none or its 45-day
 * window has closed.
 */
export async function linkedDeviceOfSession(env: Env, session: Session): Promise<Device | null> {
  const row = await db(env)
    .prepare(
      `SELECT device_id AS deviceId FROM devices
        WHERE session_id = ? AND account_id = ? AND kind = 'web' AND revoked_at IS NULL`,
    )
    .bind(session.sessionId, session.accountId)
    .first<{ deviceId: string }>();
  if (!row || !(await touchLinkedDevice(env, row.deviceId))) return null;
  return { accountId: session.accountId, deviceId: row.deviceId };
}

/**
 * Revokes linked non-phone devices that have made no authenticated request in
 * 45 days (decision 0064) and deletes expired link requests. The web session
 * survives the device's removal, and remaining devices remove the expired
 * device's MLS leaves per decision 0028.
 */
export async function expireLinkedDevices(env: Env, now = Date.now()): Promise<number> {
  const cutoff = now - LINKED_IDLE_MS;
  const [, , revoked] = await db(env).batch<{ accountId: string; deviceId: string }>([
    db(env).prepare("DELETE FROM device_link_requests WHERE expires_at <= ?").bind(now),
    db(env)
      .prepare(
        `DELETE FROM key_packages WHERE device_id IN
           (SELECT device_id FROM devices
             WHERE kind != 'phone' AND revoked_at IS NULL AND last_seen_at <= ?)`,
      )
      .bind(cutoff),
    db(env)
      .prepare(
        `UPDATE devices SET revoked_at = ?, push_token = NULL, store_key_share = NULL
          WHERE kind != 'phone' AND revoked_at IS NULL AND last_seen_at <= ?
          RETURNING account_id AS accountId, device_id AS deviceId`,
      )
      .bind(now, cutoff),
  ]);
  const list = revoked?.results ?? [];
  for (const { accountId, deviceId } of list) {
    await inbox(env, accountId).closeDevice(deviceId);
  }
  return list.length;
}
