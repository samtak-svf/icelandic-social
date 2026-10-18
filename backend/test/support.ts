import { env } from "cloudflare:workers";
import { base64url } from "../src/bytes.ts";
import { tokenHash } from "../src/identity/accounts.ts";
import { mls } from "./mls.ts";

// Shared by the tests: the EU check for Durable Object stubs, and seeded
// accounts, devices and browser sessions.

/**
 * Local workerd does not implement jurisdictions (`jurisdiction()` throws
 * "Jurisdiction restrictions are not implemented in workerd"), so a namespace
 * is wrapped: the wrapper records the jurisdiction asked for, refuses any but
 * "eu", and hands back the real namespace. Every other way to make a stub
 * throws, so a stub made without `.jurisdiction("eu")` fails the test that
 * reaches it.
 */
export function euOnly<N extends object>(real: N) {
  const asked: string[] = [];
  const bare = () => {
    throw new Error("stub made without a jurisdiction");
  };
  const namespace = {
    jurisdiction(jurisdiction: string) {
      asked.push(jurisdiction);
      if (jurisdiction !== "eu") throw new Error(`stub pinned to ${jurisdiction}, not eu`);
      return real;
    },
    idFromName: bare,
    idFromString: bare,
    newUniqueId: bare,
    get: bare,
    getByName: bare,
  } as unknown as N;
  return { namespace, asked };
}

/** `env` with every Durable Object namespace behind `euOnly`. */
export function euEnv(real: Env): Env {
  return {
    ...real,
    CONVERSATION: euOnly(real.CONVERSATION).namespace,
    INBOX: euOnly(real.INBOX).namespace,
    SPACE: euOnly(real.SPACE).namespace,
  };
}

let seeded = 0;

/**
 * A new account with one active device, the headers that act as it, and a
 * KeyPackage naming it. Seeded ids never take the fixture's `a_1/d_1`.
 */
export async function device({
  accountId = `acct_${++seeded}`,
  deviceId = `dev_${++seeded}`,
  deviceKey = crypto.getRandomValues(new Uint8Array(32)),
  token = `dt_${crypto.randomUUID().replaceAll("-", "")}`,
} = {}) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO accounts (account_id, created_at) VALUES (?, ?)").bind(
      accountId,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO devices (device_id, account_id, platform, device_key, token_hash, created_at)
       VALUES (?, ?, 'android', ?, ?, ?)`,
    ).bind(deviceId, accountId, deviceKey, await tokenHash(token), now),
  ]);
  return {
    accountId,
    deviceId,
    deviceKey,
    token,
    auth: { authorization: `Bearer ${token}` },
    keyPackage: mls.keyPackageNaming(`${accountId}/${deviceId}`, deviceKey),
  };
}

/** Revokes a seeded device's token. */
export async function revoke(deviceId: string) {
  await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE device_id = ?")
    .bind(Date.now(), deviceId)
    .run();
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A browser session on an account (decision 0061), as web sign-in leaves
 * one, and the headers that act in it from the web host. `lastSeen` and
 * `created` are how long ago, in days; it expires 30 days after `lastSeen`.
 */
export async function webSession({
  accountId = `acct_${++seeded}`,
  lastSeen = 0,
  created = lastSeen,
}: { accountId?: string; lastSeen?: number; created?: number } = {}) {
  const now = Date.now();
  const sessionId = `ses_${++seeded}`;
  const secret = `st_${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO accounts (account_id, created_at) VALUES (?, ?)").bind(
      accountId,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO sessions (session_id, account_id, kind, secret_hash, created_at, last_seen_at, expires_at)
       VALUES (?, ?, 'web', ?, ?, ?, ?)`,
    ).bind(
      sessionId,
      accountId,
      await tokenHash(secret),
      now - created * DAY_MS,
      now - lastSeen * DAY_MS,
      now - lastSeen * DAY_MS + 30 * DAY_MS,
    ),
  ]);
  const cookie = `__Host-session=${secret}`;
  return {
    accountId,
    sessionId,
    secret,
    cookie,
    web: { cookie, origin: "https://spjall.samtak.is" },
  };
}
