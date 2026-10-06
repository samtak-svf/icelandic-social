import { env } from "cloudflare:workers";
import { tokenHash } from "../src/accounts.ts";

// Shared by the tests: the EU check for Durable Object stubs, and seeded
// accounts and devices.

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

/** `env` with both Durable Object namespaces behind `euOnly`. */
export function euEnv(real: Env): Env {
  return {
    ...real,
    CONVERSATION: euOnly(real.CONVERSATION).namespace,
    INBOX: euOnly(real.INBOX).namespace,
  };
}

let seeded = 0;

/** A new account with one active device, and the headers that act as it. */
export async function device({
  accountId = `a_${++seeded}`,
  token = `dt_${crypto.randomUUID().replaceAll("-", "")}`,
} = {}) {
  const deviceId = `d_${++seeded}`;
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO accounts (account_id, created_at) VALUES (?, ?)").bind(
      accountId,
      now,
    ),
    env.DB.prepare(
      `INSERT INTO devices (device_id, account_id, platform, device_key, token_hash, created_at)
       VALUES (?, ?, 'android', ?, ?, ?)`,
    ).bind(deviceId, accountId, new Uint8Array(32), await tokenHash(token), now),
  ]);
  return { accountId, deviceId, token, auth: { authorization: `Bearer ${token}` } };
}

/** Revokes a seeded device's token. */
export async function revoke(deviceId: string) {
  await env.DB.prepare("UPDATE devices SET revoked_at = ? WHERE device_id = ?")
    .bind(Date.now(), deviceId)
    .run();
}
