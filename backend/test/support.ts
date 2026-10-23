import { env } from "cloudflare:workers";
import { base64url, toBase64 } from "../src/bytes.ts";
import { tokenHash } from "../src/identity/accounts.ts";
import { worker } from "./main.ts";
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

/** A phone device backed by a real Ed25519 key pair so it can sign link approvals. */
export async function phoneWithKey(accountId?: string) {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const phone = await device(accountId ? { accountId } : {});
  await env.DB.prepare("UPDATE devices SET device_key = ? WHERE device_id = ?")
    .bind(publicKey, phone.deviceId)
    .run();
  return {
    ...phone,
    publicKey,
    sign: async (message: Uint8Array) =>
      new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, message)),
    /** The approval of `linkId` for `deviceKey`, signed as decision 0077 says. */
    approve: async (linkId: string, deviceKey: Uint8Array) =>
      new Uint8Array(
        await crypto.subtle.sign("Ed25519", pair.privateKey, approvalMessage(linkId, deviceKey)),
      ),
  };
}

/** What a phone signs to approve a link (decision 0077), built here apart from the server's copy. */
function approvalMessage(linkId: string, deviceKey: Uint8Array): Uint8Array {
  const parts = [
    new TextEncoder().encode("spjall device link v1\0"),
    new TextEncoder().encode(linkId),
    deviceKey,
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
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

/**
 * A browser session whose link a phone approved (`history` is what the phone
 * says about a history, absent for a 0.37 app) and, with `complete`, that
 * completed it: the linked device and what `complete` answered.
 */
export async function linkedBrowser({
  history,
  complete = true,
}: { history?: "none" | "sent"; complete?: boolean } = {}) {
  const phone = await phoneWithKey();
  const browser = await webSession({ accountId: phone.accountId });
  const deviceKey = crypto.getRandomValues(new Uint8Array(32));
  const json = { "content-type": "application/json" };
  const started = await worker.fetch("https://spjall.test/v1/devices/link-requests", {
    method: "POST",
    headers: { ...browser.web, ...json },
    body: JSON.stringify({
      deviceKey: toBase64(deviceKey),
      historyKey: toBase64(crypto.getRandomValues(new Uint8Array(32))),
    }),
  });
  const { linkId } = (await started.json()) as { linkId: string };
  const signature = toBase64(await phone.approve(linkId, deviceKey));
  const approved = await worker.fetch(
    `https://spjall.test/v1/devices/link-requests/${linkId}/approve`,
    {
      method: "POST",
      headers: { ...phone.auth, ...json },
      body: JSON.stringify(history === undefined ? { signature } : { signature, history }),
    },
  );
  if (approved.status !== 204) throw new Error(`approve answered ${approved.status}`);
  if (!complete) return { phone, browser, linkId, enrolled: null };
  const completed = await worker.fetch(
    `https://spjall.test/v1/devices/link-requests/${linkId}/complete`,
    { method: "POST", headers: browser.web },
  );
  if (completed.status !== 200) throw new Error(`complete answered ${completed.status}`);
  const enrolled = (await completed.json()) as {
    deviceId: string;
    token: string;
    historyExpected: boolean;
  };
  return { phone, browser, linkId, enrolled };
}
