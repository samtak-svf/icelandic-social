import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../app.ts";
import {
  approveDeviceLinkRoute,
  completeDeviceLinkRoute,
  createDeviceLinkRoute,
  getDeviceLinkRoute,
  getLinkedStoreKeyRoute,
  getPendingStoreKeyRoute,
} from "../api/linked-devices.ts";
import { fromBase64, toBase64 } from "../bytes.ts";
import { db } from "../env/index.ts";
import { fail } from "../errors.ts";
import { log } from "../log.ts";
import type { Platform } from "../platforms.ts";
import { type Device, randomToken, tokenHash } from "./accounts.ts";
import { approvalMessage } from "./link-approval.ts";
import { LINKED_IDLE_MS } from "./linked-device-lifecycle.ts";
import { pendingStoreKeyShare } from "./pending-store-key.ts";
import { type Session, wipeBrowserStorage } from "./sessions.ts";

// Enrolling a linked non-phone device from a browser session (decision 0064,
// #299): the browser starts a link request with its Ed25519 device key and a
// one-time X25519 history key; an active phone of the same account approves it
// once, signing the link id and the new device's key (decision 0077); the
// browser completes enrolment and receives its device token and the server's
// 32-byte half of its two-part store key. That half is made with the request and
// handed to the requesting session while it waits (decision 0096), so the browser
// seals its store in two parts before the phone approves. A linked device
// expires after 45 days without use, and revoking it leaves its browser session
// signed in.

/** A pending QR link request expires after 10 minutes. */
const LINK_REQUEST_MS = 10 * 60 * 1000;
async function createLinkRequest(
  env: Env,
  session: Session,
  keys: { deviceKey: Uint8Array; historyKey: Uint8Array },
  now = Date.now(),
): Promise<
  | { ok: { linkId: string; expiresAt: number } }
  | { error: "no_phone_device" | "device_key_taken" | "session_already_linked" }
> {
  const [phone, existingDevice, keyTaken] = await db(env).batch([
    db(env)
      .prepare(
        "SELECT 1 FROM devices WHERE account_id = ? AND kind = 'phone' AND revoked_at IS NULL LIMIT 1",
      )
      .bind(session.accountId),
    db(env)
      .prepare("SELECT 1 FROM devices WHERE session_id = ? AND revoked_at IS NULL LIMIT 1")
      .bind(session.sessionId),
    db(env).prepare("SELECT 1 FROM devices WHERE device_key = ? LIMIT 1").bind(keys.deviceKey),
  ]);
  if ((phone?.results.length ?? 0) === 0) return { error: "no_phone_device" };
  if ((existingDevice?.results.length ?? 0) > 0) return { error: "session_already_linked" };
  if ((keyTaken?.results.length ?? 0) > 0) return { error: "device_key_taken" };

  const linkId = randomToken("dl_");
  const expiresAt = now + LINK_REQUEST_MS;
  const share = crypto.getRandomValues(new Uint8Array(32));
  await db(env).batch([
    db(env)
      .prepare("DELETE FROM device_link_requests WHERE session_id = ?")
      .bind(session.sessionId),
    db(env)
      .prepare(
        `INSERT INTO device_link_requests
           (link_id, session_id, account_id, device_key, history_key, created_at, expires_at,
            store_key_share)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        linkId,
        session.sessionId,
        session.accountId,
        keys.deviceKey,
        keys.historyKey,
        now,
        expiresAt,
        share,
      ),
  ]);
  return { ok: { linkId, expiresAt } };
}

async function getLinkRequest(env: Env, accountId: string, linkId: string, now = Date.now()) {
  const row = await db(env)
    .prepare(
      `SELECT r.link_id AS linkId, r.session_id AS sessionId, s.browser, s.os,
              r.device_key AS deviceKey, r.history_key AS historyKey,
              r.expires_at AS expiresAt, r.approved_by_device_id AS approvedBy
         FROM device_link_requests r
         JOIN sessions s ON s.session_id = r.session_id
        WHERE r.link_id = ? AND r.account_id = ? AND r.expires_at > ?`,
    )
    .bind(linkId, accountId, now)
    .first<{
      linkId: string;
      sessionId: string;
      browser: string | null;
      os: string | null;
      deviceKey: ArrayBuffer;
      historyKey: ArrayBuffer;
      expiresAt: number;
      approvedBy: string | null;
    }>();
  if (!row) return null;
  return {
    linkId: row.linkId,
    sessionId: row.sessionId,
    browser: row.browser,
    os: row.os,
    deviceKey: toBase64(new Uint8Array(row.deviceKey)),
    historyKey: toBase64(new Uint8Array(row.historyKey)),
    expiresAt: row.expiresAt,
    approved: row.approvedBy !== null,
  };
}

async function approveLinkRequest(
  env: Env,
  approver: Device,
  linkId: string,
  signature: Uint8Array,
  history: "none" | "sent" = "sent",
  now = Date.now(),
): Promise<
  | { ok: true }
  | { error: "not_found" | "phone_required" | "invalid_signature" | "already_approved" }
> {
  const [phoneRow, reqRow] = await db(env).batch([
    db(env)
      .prepare(
        `SELECT device_key AS deviceKey, kind FROM devices
          WHERE device_id = ? AND account_id = ? AND revoked_at IS NULL`,
      )
      .bind(approver.deviceId, approver.accountId),
    db(env)
      .prepare(
        `SELECT device_key AS deviceKey, approved_by_device_id AS approvedBy
           FROM device_link_requests
          WHERE link_id = ? AND account_id = ? AND expires_at > ?`,
      )
      .bind(linkId, approver.accountId, now),
  ]);
  const phone = phoneRow?.results[0] as { deviceKey: ArrayBuffer; kind: string } | undefined;
  if (!phone || phone.kind !== "phone") return { error: "phone_required" };
  const req = reqRow?.results[0] as
    | { deviceKey: ArrayBuffer; approvedBy: string | null }
    | undefined;
  if (!req) return { error: "not_found" };
  if (req.approvedBy !== null) return { error: "already_approved" };

  let valid = false;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(phone.deviceKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const message = approvalMessage(linkId, new Uint8Array(req.deviceKey));
    valid = await crypto.subtle.verify("Ed25519", key, signature, message);
  } catch {
    valid = false;
  }
  if (!valid) return { error: "invalid_signature" };

  // The guard on approved_by_device_id makes a race between two phones approve once.
  const updated = await db(env)
    .prepare(
      `UPDATE device_link_requests
          SET approved_by_device_id = ?, approval_signature = ?, approved_at = ?,
              history_expected = ?
        WHERE link_id = ? AND account_id = ? AND approved_by_device_id IS NULL`,
    )
    .bind(approver.deviceId, signature, now, history === "sent" ? 1 : 0, linkId, approver.accountId)
    .run();
  return updated.meta.changes === 1 ? { ok: true } : { error: "already_approved" };
}

async function completeLinkRequest(
  env: Env,
  session: Session,
  linkId: string,
  now = Date.now(),
): Promise<
  | {
      ok: {
        accountId: string;
        deviceId: string;
        sessionId: string;
        token: string;
        storeKeyShare: string;
        historyExpected: boolean;
      };
    }
  | { error: "not_found" | "not_approved" | "device_key_taken" }
> {
  const row = await db(env)
    .prepare(
      `SELECT r.device_key AS deviceKey, r.approved_by_device_id AS approvedBy,
              r.history_expected AS historyExpected, r.store_key_share AS storeKeyShare,
              p.platform AS phonePlatform, p.revoked_at AS phoneRevokedAt
         FROM device_link_requests r
         LEFT JOIN devices p ON p.device_id = r.approved_by_device_id
                AND p.account_id = r.account_id AND p.kind = 'phone'
        WHERE r.link_id = ? AND r.session_id = ? AND r.account_id = ? AND r.expires_at > ?`,
    )
    .bind(linkId, session.sessionId, session.accountId, now)
    .first<{
      deviceKey: ArrayBuffer;
      approvedBy: string | null;
      historyExpected: number;
      storeKeyShare: ArrayBuffer | null;
      phonePlatform: Platform | null;
      phoneRevokedAt: number | null;
    }>();
  if (!row) return { error: "not_found" };
  if (!row.approvedBy || !row.phonePlatform || row.phoneRevokedAt !== null) {
    return { error: "not_approved" };
  }
  const deviceKey = new Uint8Array(row.deviceKey);
  const taken = await db(env)
    .prepare("SELECT 1 FROM devices WHERE device_key = ?")
    .bind(deviceKey)
    .first();
  if (taken) return { error: "device_key_taken" };

  const deviceId = randomToken("d_");
  const token = randomToken("dt_");
  const hash = await tokenHash(token);
  // The share the browser sealed its store with while it waited (0096).
  const share = row.storeKeyShare
    ? new Uint8Array(row.storeKeyShare)
    : crypto.getRandomValues(new Uint8Array(32));
  await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO devices
           (device_id, account_id, platform, kind, device_key, token_hash, created_at,
            session_id, last_seen_at, store_key_share, link_id, linked_by_device_id)
         VALUES (?, ?, ?, 'web', ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        deviceId,
        session.accountId,
        row.phonePlatform,
        deviceKey,
        hash,
        now,
        session.sessionId,
        now,
        share,
        linkId,
        row.approvedBy,
      ),
    db(env).prepare("DELETE FROM device_link_requests WHERE link_id = ?").bind(linkId),
  ]);
  return {
    ok: {
      accountId: session.accountId,
      deviceId,
      sessionId: session.sessionId,
      token,
      storeKeyShare: toBase64(share),
      historyExpected: row.historyExpected === 1,
    },
  };
}

/**
 * A link an active phone approved: who approved it and when, and the device it
 * made once completed (when it was made, for a completed one).
 */
export type ApprovedLink = {
  accountId: string;
  approvedBy: string;
  approvedAt: number;
  deviceId: string | null;
};

/**
 * The approved link `linkId`, pending or completed (decision 0064, #300): a
 * request an active phone approved and the browser has yet to complete, or
 * the active linked device completing it made. Null for any other link, one
 * whose approving phone is revoked, or one whose device is revoked.
 */
export async function approvedLink(
  env: Env,
  linkId: string,
  now = Date.now(),
): Promise<ApprovedLink | null> {
  const [pending, completed] = await db(env).batch<ApprovedLink>([
    db(env)
      .prepare(
        `SELECT r.account_id AS accountId, r.approved_by_device_id AS approvedBy,
                r.approved_at AS approvedAt, NULL AS deviceId
           FROM device_link_requests r
           JOIN devices p ON p.device_id = r.approved_by_device_id AND p.revoked_at IS NULL
          WHERE r.link_id = ? AND r.expires_at > ?`,
      )
      .bind(linkId, now),
    db(env)
      .prepare(
        `SELECT d.account_id AS accountId, d.linked_by_device_id AS approvedBy,
                d.created_at AS approvedAt, d.device_id AS deviceId
           FROM devices d
           JOIN devices p ON p.device_id = d.linked_by_device_id AND p.revoked_at IS NULL
          WHERE d.link_id = ? AND d.revoked_at IS NULL`,
      )
      .bind(linkId),
  ]);
  return pending?.results[0] ?? completed?.results[0] ?? null;
}

/** The server's 32-byte store-key share for the active linked device of this web session. */
async function storeKeyShareForSession(
  env: Env,
  session: Session,
  now = Date.now(),
): Promise<{ deviceId: string; storeKeyShare: string } | null> {
  const row = await db(env)
    .prepare(
      `SELECT device_id AS deviceId, store_key_share AS storeKeyShare, last_seen_at AS lastSeenAt
         FROM devices
        WHERE session_id = ? AND account_id = ? AND kind != 'phone' AND revoked_at IS NULL`,
    )
    .bind(session.sessionId, session.accountId)
    .first<{
      deviceId: string;
      storeKeyShare: ArrayBuffer | null;
      lastSeenAt: number | null;
    }>();
  if (!row || !row.storeKeyShare) return null;
  if (row.lastSeenAt !== null && row.lastSeenAt + LINKED_IDLE_MS <= now) return null;
  return {
    deviceId: row.deviceId,
    storeKeyShare: toBase64(new Uint8Array(row.storeKeyShare)),
  };
}

export function linkedDeviceRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(createDeviceLinkRoute, async (c) => {
    const { session } = c.var;
    const body = c.req.valid("json");
    const created = await createLinkRequest(c.env, session, {
      deviceKey: fromBase64(body.deviceKey),
      historyKey: fromBase64(body.historyKey),
    });
    if ("error" in created) {
      return created.error === "no_phone_device"
        ? fail(c, 403, created.error)
        : fail(c, 409, created.error);
    }
    return c.json(created.ok, 200);
  });

  app.openapi(getDeviceLinkRoute, async (c) => {
    const { accountId } = c.var.session;
    const { linkId } = c.req.valid("param");
    const found = await getLinkRequest(c.env, accountId, linkId);
    if (!found) return fail(c, 404, "not_found");
    return c.json(found, 200);
  });

  app.openapi(approveDeviceLinkRoute, async (c) => {
    const { linkId } = c.req.valid("param");
    const { signature, history } = c.req.valid("json");
    const approved = await approveLinkRequest(
      c.env,
      c.var.device,
      linkId,
      fromBase64(signature),
      history,
    );
    if ("error" in approved) {
      const { error } = approved;
      return fail(c, error === "not_found" ? 404 : error === "already_approved" ? 409 : 403, error);
    }
    log("device.link_approved", {
      accountId: c.var.device.accountId,
      deviceId: c.var.device.deviceId,
    });
    return c.body(null, 204);
  });

  app.openapi(completeDeviceLinkRoute, async (c) => {
    const { session } = c.var;
    const { linkId } = c.req.valid("param");
    const completed = await completeLinkRequest(c.env, session, linkId);
    if ("error" in completed) {
      return completed.error === "not_found"
        ? fail(c, 404, completed.error)
        : fail(c, 409, completed.error);
    }
    log("device.linked", {
      accountId: completed.ok.accountId,
      deviceId: completed.ok.deviceId,
      sessionId: completed.ok.sessionId,
    });
    return c.json(completed.ok, 200);
  });

  app.openapi(getPendingStoreKeyRoute, async (c) => {
    const { linkId } = c.req.valid("param");
    const found = await pendingStoreKeyShare(c.env, c.var.session, linkId);
    if (!found) return fail(c, 404, "not_found");
    return c.json(found, 200);
  });

  app.openapi(getLinkedStoreKeyRoute, async (c) => {
    const { session } = c.var;
    const found = await storeKeyShareForSession(c.env, session);
    if (!found) {
      wipeBrowserStorage(c);
      return fail(c, 404, "not_found");
    }
    return c.json(found, 200);
  });
}
