import { db } from "../env/index.ts";
import type { Platform } from "../platforms.ts";
import { type Device, randomToken, tokenHash } from "./accounts.ts";

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

const DAY_MS = 24 * 60 * 60 * 1000;
/** A browser session lasts this long from its last use... */
const IDLE_MS = 30 * DAY_MS;
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
  const { accountId, deviceId } = row;
  const sessionId = row.sessionId ?? (await healSession(env, row));
  return {
    device: { accountId, deviceId },
    session: { accountId, sessionId, kind: row.kind ?? row.platform },
  };
}
