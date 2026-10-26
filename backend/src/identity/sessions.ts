import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { db } from "../env/index.ts";
import type { Platform } from "../shared/platforms.ts";
import { type Device, randomToken, tokenHash } from "./accounts.ts";
import { touchLinkedDevice } from "./linked-device-lifecycle.ts";

// Sessions (decision 0061): one sign-in on one client. A browser proves its
// session with the secret in its cookie; a phone with its device's token,
// which yields the session the device was enrolled from.

/** The client a session is on. */
type SessionKind = "web" | Platform;

/** The session a request acts in, whichever way it proved it. */
export type Session = { accountId: string; sessionId: string; kind: SessionKind };

/**
 * The cookie that carries a browser's session secret, set and read with
 * Hono's `host` prefix: `__Host-session`, which a browser accepts only from
 * this host, Secure, with Path=/ and no Domain.
 */
export const SESSION_COOKIE = "session";

/**
 * Ends what a browser keeps for this site (decision 0064): answers with
 * `Clear-Site-Data: "storage"`, the one wipe found complete in every engine.
 * Only a request that carried the session cookie gets it. A phone's bearer
 * request never does, and nor does a linked device's own, whose session is
 * a browser's but which is not the browser asking.
 */
export function wipeBrowserStorage(c: Context): void {
  if (getCookie(c, SESSION_COOKIE, "host") !== undefined) {
    c.header("clear-site-data", '"storage"');
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** A browser session lasts this long from its last use... */
export const IDLE_MS = 30 * DAY_MS;
/** ...renewed at most once a day... */
const RENEW_MS = DAY_MS;
/** ...and never beyond this from sign-in, the longest a browser keeps a cookie. */
const LONGEST_MS = 400 * DAY_MS;

/** The cookie's attributes, until `expires`: script on the page never reads it. */
export function sessionCookie(expires: number) {
  return {
    prefix: "host",
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(expires),
  } as const;
}

/** What a browser session secret looks like; anything else is never looked up. */
export const SESSION_SECRET = /^st_[A-Za-z0-9_-]{43}$/;

/**
 * The live browser session this secret proves, or null. A session used more
 * than a day after its last renewal is renewed: `renewed` is then its new
 * expiry, which the cookie must carry too.
 */
export async function sessionForSecret(
  env: Env,
  secret: string,
  now = Date.now(),
): Promise<{ session: Session; renewed: number | null } | null> {
  const row = await db(env)
    .prepare(
      `SELECT session_id AS sessionId, account_id AS accountId, created_at AS createdAt,
              last_seen_at AS lastSeenAt
         FROM sessions WHERE secret_hash = ? AND kind = 'web' AND expires_at > ?`,
    )
    .bind(await tokenHash(secret), now)
    .first<{ sessionId: string; accountId: string; createdAt: number; lastSeenAt: number }>();
  if (!row) return null;
  const session = { accountId: row.accountId, sessionId: row.sessionId, kind: "web" as const };
  if (now - row.lastSeenAt < RENEW_MS) return { session, renewed: null };
  const expires = Math.min(now + IDLE_MS, row.createdAt + LONGEST_MS);
  await db(env)
    .prepare("UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE session_id = ?")
    .bind(now, expires, row.sessionId)
    .run();
  return { session, renewed: expires };
}

/** The product names a session's label is made of; any other browser or system is left out. */
const BROWSERS = [
  ["Edge", /\bEdg(e|A|iOS)?\//],
  ["Opera", /\b(OPR|Opera)\//],
  ["Samsung Internet", /\bSamsungBrowser\//],
  ["Firefox", /\b(Firefox|FxiOS)\//],
  ["Chrome", /\b(Chrome|CriOS)\//],
  ["Safari", /\bVersion\/[\d.]+.*\bSafari\//],
] as const;
const SYSTEMS = [
  ["iOS", /\b(iPhone|iPad|iPod)\b/],
  ["Android", /\bAndroid\b/],
  ["ChromeOS", /\bCrOS\b/],
  ["Windows", /\bWindows\b/],
  ["macOS", /\bMac OS X\b/],
  ["Linux", /\bLinux\b/],
] as const;

/**
 * The coarse label a browser session is shown by ("Firefox", "Linux"): one
 * name from each fixed list, or null. The user-agent itself is never kept.
 */
export function sessionLabel(userAgent: string | undefined) {
  const ua = userAgent ?? "";
  const first = (list: readonly (readonly [string, RegExp])[]) =>
    list.find(([, pattern]) => pattern.test(ua))?.[0] ?? null;
  return { browser: first(BROWSERS), os: first(SYSTEMS) };
}

/** A browser's new session: its id, the secret its cookie carries, and that secret's hash. */
export async function newBrowserSession() {
  const secret = randomToken("st_");
  return { sessionId: randomToken("s_"), secret, secretHash: await tokenHash(secret) };
}

/** The statement that makes a browser's session on an account, at sign-in; it expires at `now + IDLE_MS`. */
export function browserSession(
  env: Env,
  session: { sessionId: string; secretHash: string; browser: string | null; os: string | null },
  accountId: string,
  now: number,
) {
  return db(env)
    .prepare(
      `INSERT INTO sessions (session_id, account_id, kind, secret_hash, browser, os, created_at, last_seen_at, expires_at)
       VALUES (?, ?, 'web', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      session.sessionId,
      accountId,
      session.secretHash,
      session.browser,
      session.os,
      now,
      now,
      now + IDLE_MS,
    );
}

/** The statement that makes a phone's session, enrolled with its device. */
export function phoneSession(env: Env, session: Session, now: number) {
  return db(env)
    .prepare(
      `INSERT INTO sessions (session_id, account_id, kind, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(session.sessionId, session.accountId, session.kind, now, now);
}

/**
 * The session of an active device that has none: one enrolled by a build
 * that wrote devices between migration 0013 and the deploy after it. It is
 * given one now, so every device yields a session.
 */
async function healSession(
  env: Env,
  device: { accountId: string; deviceId: string; platform: Platform },
): Promise<string> {
  const sessionId = randomToken("s_");
  const { accountId, platform: kind } = device;
  await db(env).batch([
    phoneSession(env, { sessionId, accountId, kind }, Date.now()),
    db(env)
      .prepare("UPDATE devices SET session_id = ? WHERE device_id = ? AND session_id IS NULL")
      .bind(sessionId, device.deviceId),
  ]);
  const { session } = (await db(env)
    .prepare("SELECT session_id AS session FROM devices WHERE device_id = ?")
    .bind(device.deviceId)
    .first<{ session: string }>())!;
  // Another request healed it first: the session made here is not used.
  if (session !== sessionId) {
    await db(env).prepare("DELETE FROM sessions WHERE session_id = ?").bind(sessionId).run();
  }
  return session;
}

/**
 * The active device that holds this token, and the session it was enrolled
 * from (decision 0061), or null.
 */
export async function deviceForToken(
  env: Env,
  token: string,
): Promise<{ device: Device; session: Session } | null> {
  const row = await db(env)
    .prepare(
      `SELECT d.account_id AS accountId, d.device_id AS deviceId, d.platform,
              s.session_id AS sessionId, s.kind
         FROM devices d LEFT JOIN sessions s ON s.session_id = d.session_id
        WHERE d.token_hash = ? AND d.revoked_at IS NULL`,
    )
    .bind(await tokenHash(token))
    .first<
      Device & { platform: Platform; sessionId: string | null; kind: Session["kind"] | null }
    >();
  if (!row) return null;
  if (row.kind === "web" && !(await touchLinkedDevice(env, row.deviceId))) return null;
  const { accountId, deviceId } = row;
  const sessionId = row.sessionId ?? (await healSession(env, row));
  return {
    device: { accountId, deviceId },
    session: { accountId, sessionId, kind: row.kind ?? row.platform },
  };
}

/** Every session of the account, newest first, with the device a phone's enrolled. */
export async function sessionsOf(env: Env, accountId: string) {
  const { results } = await db(env)
    .prepare(
      `SELECT s.session_id AS sessionId, s.kind, s.browser, s.os, d.device_id AS deviceId,
              s.created_at AS createdAt, s.last_seen_at AS lastSeenAt, s.expires_at AS expiresAt
         FROM sessions s
         LEFT JOIN devices d ON d.session_id = s.session_id AND d.revoked_at IS NULL
        WHERE s.account_id = ? ORDER BY s.created_at DESC, s.session_id`,
    )
    .bind(accountId)
    .all<{
      sessionId: string;
      kind: SessionKind;
      browser: string | null;
      os: string | null;
      deviceId: string | null;
      createdAt: number;
      lastSeenAt: number;
      expiresAt: number | null;
    }>();
  return results;
}

/**
 * Ends sessions of the account (decision 0061), and revokes the devices they
 * enrolled as `revokeDevice` does: their tokens fail at once and their
 * KeyPackages go. `which` is one session, or every session but one. How many
 * sessions ended, and the devices revoked, whose sockets the caller closes.
 */
export async function endSessions(
  env: Env,
  accountId: string,
  which: { only: string } | { except: string },
): Promise<{ ended: number; devices: string[] }> {
  const [match, id] =
    "only" in which ? ["session_id = ?", which.only] : ["session_id != ?", which.except];
  const ending = `SELECT session_id FROM sessions WHERE account_id = ? AND ${match}`;
  const [, revoked, ended] = await db(env).batch<{ deviceId?: string }>([
    db(env)
      .prepare(
        `DELETE FROM key_packages WHERE device_id IN
         (SELECT device_id FROM devices WHERE session_id IN (${ending}))`,
      )
      .bind(accountId, id),
    db(env)
      .prepare(
        `UPDATE devices SET revoked_at = ?, push_token = NULL, store_key_share = NULL
          WHERE revoked_at IS NULL AND session_id IN (${ending}) RETURNING device_id AS deviceId`,
      )
      .bind(Date.now(), accountId, id),
    // RETURNING, since changes() counts the devices a delete sets null too.
    db(env)
      .prepare(`DELETE FROM sessions WHERE account_id = ? AND ${match} RETURNING session_id`)
      .bind(accountId, id),
  ]);
  return {
    ended: ended?.results.length ?? 0,
    devices: (revoked?.results ?? []).flatMap((r) => (r.deviceId ? [r.deviceId] : [])),
  };
}

/** Deletes the browser sessions past their expiry: the scheduled sweep (decision 0061). */
export async function expireSessions(env: Env, now = Date.now()): Promise<number> {
  const { results } = await db(env)
    .prepare("DELETE FROM sessions WHERE expires_at <= ? RETURNING session_id")
    .bind(now)
    .all();
  return results.length;
}
