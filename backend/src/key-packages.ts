import type { Device } from "./accounts.ts";
import { fromBase64 } from "./bytes.ts";
import { db } from "./env/index.ts";
import { FramingError, readFraming } from "./mls/framing.ts";

// KeyPackages in D1 (decisions 0002, 0017): a device uploads them, and a
// member who adds its account to a group claims one per active device. A
// package must name the device that uploads it (0018), so a claimer is never
// handed a key its account did not register.

/** MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519, the only suite (decision 0002). */
const CIPHER_SUITE = 0x0001;

/** The most unclaimed packages a device may hold, besides its last resort. */
const MAX_HELD = 100;

/** What a device's KeyPackage must carry in its leaf. */
type Owner = { identity: Uint8Array; deviceKey: Uint8Array };

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

/**
 * The bytes of a KeyPackage in the pinned suite whose leaf names its owner
 * and carries the owner's device key, or null for anything else.
 */
function keyPackage(text: string, owner: Owner): Uint8Array | null {
  const bytes = fromBase64(text);
  try {
    const framing = readFraming(bytes);
    return framing.wireFormat === "key_package" &&
      framing.cipherSuite === CIPHER_SUITE &&
      equal(framing.identity, owner.identity) &&
      equal(framing.signatureKey, owner.deviceKey)
      ? bytes
      : null;
  } catch (error) {
    if (error instanceof FramingError) return null;
    throw error;
  }
}

async function available(env: Env, deviceId: string): Promise<number> {
  const row = await db(env)
    .prepare("SELECT count(*) AS n FROM key_packages WHERE device_id = ? AND last_resort = 0")
    .bind(deviceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Adds a device's packages and replaces its last resort, in one batch.
 * Refused whole if any is not a KeyPackage in the pinned suite naming this
 * device, or if the device would hold more than MAX_HELD.
 */
export async function upload(
  env: Env,
  { accountId, deviceId }: Device,
  body: { keyPackages: string[]; lastResort?: string },
): Promise<{ available: number } | null> {
  const row = await db(env)
    .prepare("SELECT device_key AS deviceKey FROM devices WHERE device_id = ?")
    .bind(deviceId)
    .first<{ deviceKey: ArrayBuffer | number[] }>();
  if (!row) return null;
  const owner = {
    identity: new TextEncoder().encode(`${accountId}/${deviceId}`),
    deviceKey: new Uint8Array(row.deviceKey),
  };
  const packages = body.keyPackages.map((text) => keyPackage(text, owner));
  const lastResort = body.lastResort === undefined ? undefined : keyPackage(body.lastResort, owner);
  if (packages.includes(null) || lastResort === null) return null;
  if ((await available(env, deviceId)) + packages.length > MAX_HELD) return null;

  const now = Date.now();
  const insert = db(env).prepare(
    "INSERT INTO key_packages (device_id, key_package, last_resort, created_at) VALUES (?, ?, ?, ?)",
  );
  const statements = packages.map((bytes) => insert.bind(deviceId, bytes, 0, now));
  if (lastResort) {
    statements.push(
      db(env)
        .prepare("DELETE FROM key_packages WHERE device_id = ? AND last_resort = 1")
        .bind(deviceId),
      insert.bind(deviceId, lastResort, 1, now),
    );
  }
  if (statements.length) await db(env).batch(statements);
  return { available: await available(env, deviceId) };
}

type Claimed = { deviceId: string; keyPackage: Uint8Array };

/**
 * One package for each active device of the account but the caller's,
 * consumed in the same batch that reads it: a device adding its own account
 * is already in the group. A device with none left gives its last resort,
 * which stays. Null when the account has no active device at all.
 */
export async function claim(
  env: Env,
  accountId: string,
  caller: string,
): Promise<Claimed[] | null> {
  const { results: devices } = await db(env)
    .prepare(
      "SELECT device_id AS deviceId FROM devices WHERE account_id = ? AND revoked_at IS NULL ORDER BY device_id",
    )
    .bind(accountId)
    .all<{ deviceId: string }>();
  if (!devices.length) return null;
  const others = devices.filter(({ deviceId }) => deviceId !== caller);
  if (!others.length) return [];

  const take = db(env).prepare(
    `DELETE FROM key_packages WHERE id = (
       SELECT id FROM key_packages WHERE device_id = ? AND last_resort = 0 ORDER BY id LIMIT 1)
     RETURNING device_id AS deviceId, key_package AS keyPackage`,
  );
  const fallback = db(env).prepare(
    `SELECT device_id AS deviceId, key_package AS keyPackage
       FROM key_packages WHERE device_id = ? AND last_resort = 1`,
  );
  const results = await db(env).batch<{ deviceId: string; keyPackage: ArrayBuffer | number[] }>(
    others.flatMap(({ deviceId }) => [take.bind(deviceId), fallback.bind(deviceId)]),
  );

  const claimed: Claimed[] = [];
  for (let i = 0; i < results.length; i += 2) {
    const row = results[i]!.results[0] ?? results[i + 1]!.results[0];
    if (row) claimed.push({ deviceId: row.deviceId, keyPackage: new Uint8Array(row.keyPackage) });
  }
  return claimed;
}
