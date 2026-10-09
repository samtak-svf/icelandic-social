import type { Device } from "./accounts.ts";
import { fromBase64 } from "./bytes.ts";
import { db } from "./env/index.ts";
import { FramingError, type Leaf, readFraming } from "./mls/framing.ts";

// KeyPackages in D1 (decisions 0002, 0017): a device uploads them, and a
// member who adds its account to a group claims one per active device. A
// package must name the device that uploads it (0018), so a claimer is never
// handed a key its account did not register. Each expires when its leaf says
// (0029), and the server never hands out one about to.

/** MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519, the only suite (decision 0002). */
const CIPHER_SUITE = 0x0001;

/** The most unclaimed packages a device may hold, besides its last resort. */
const MAX_HELD = 100;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A device's KeyPackage lifetime (0029), which a row stored without `not_after` is given. */
const LIFETIME_MS = 84 * DAY_MS;

/** The furthest ahead an uploaded package may expire. */
const MAX_AHEAD_MS = 90 * DAY_MS;

/** A package expiring sooner than this is never handed out. */
const CLAIM_MARGIN_MS = DAY_MS;

/** How long a package must stay valid to count in the stock a device sees. */
const STOCK_WINDOW_MS = 14 * DAY_MS;

/** When a row's package expires, in milliseconds. */
const EXPIRES = `coalesce(not_after, created_at + ${LIFETIME_MS})`;

/** What a device's leaf must carry: its name and its device key. */
type Owner = { identity: Uint8Array; deviceKey: Uint8Array };

const equal = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((byte, i) => byte === b[i]);

async function owner(env: Env, { accountId, deviceId }: Device): Promise<Owner | null> {
  const row = await db(env)
    .prepare("SELECT device_key AS deviceKey FROM devices WHERE device_id = ?")
    .bind(deviceId)
    .first<{ deviceKey: ArrayBuffer | number[] }>();
  if (!row) return null;
  return {
    identity: new TextEncoder().encode(`${accountId}/${deviceId}`),
    deviceKey: new Uint8Array(row.deviceKey),
  };
}

const owns = (leaf: Leaf, { identity, deviceKey }: Owner) =>
  equal(leaf.identity, identity) && equal(leaf.signatureKey, deviceKey);

/** Whether a leaf, an external commit's (0021), names this device and its key. */
export async function ownsLeaf(env: Env, device: Device, leaf: Leaf): Promise<boolean> {
  const own = await owner(env, device);
  return own !== null && owns(leaf, own);
}

type Package = { bytes: Uint8Array; notAfter: number };

/**
 * A KeyPackage in the pinned suite whose leaf names its owner, carries the
 * owner's device key and is valid now and not too far ahead, with when it
 * expires; or null for anything else.
 */
function keyPackage(text: string, own: Owner, now: number): Package | null {
  const bytes = fromBase64(text);
  try {
    const framing = readFraming(bytes);
    if (
      framing.wireFormat !== "key_package" ||
      framing.cipherSuite !== CIPHER_SUITE ||
      !owns(framing, own)
    ) {
      return null;
    }
    const notAfter = framing.notAfter * 1000;
    return notAfter > now && notAfter <= now + MAX_AHEAD_MS ? { bytes, notAfter } : null;
  } catch (error) {
    if (error instanceof FramingError) return null;
    throw error;
  }
}

async function held(env: Env, deviceId: string): Promise<number> {
  const row = await db(env)
    .prepare("SELECT count(*) AS n FROM key_packages WHERE device_id = ? AND last_resort = 0")
    .bind(deviceId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export type Stock = { available: number; lastResortNotAfter: number | null };

/** What a device holds that will last the stock window, and when its last resort runs out. */
async function stock(env: Env, deviceId: string, now: number): Promise<Stock> {
  const row = await db(env)
    .prepare(
      `SELECT coalesce(sum(last_resort = 0 AND ${EXPIRES} > ?), 0) AS available,
              max(CASE WHEN last_resort = 1 THEN ${EXPIRES} END) AS lastResortNotAfter
         FROM key_packages WHERE device_id = ?`,
    )
    .bind(now + STOCK_WINDOW_MS, deviceId)
    .first<Stock>();
  return row ?? { available: 0, lastResortNotAfter: null };
}

/**
 * Adds a device's packages and replaces its last resort, in one batch.
 * Refused whole if any is not a KeyPackage in the pinned suite naming this
 * device, valid now and for at most MAX_AHEAD_MS, or if the device would
 * hold more than MAX_HELD.
 */
export async function upload(
  env: Env,
  device: Device,
  body: { keyPackages: string[]; lastResort?: string },
): Promise<Stock | null> {
  const { deviceId } = device;
  const own = await owner(env, device);
  if (!own) return null;
  const now = Date.now();
  const packages = body.keyPackages.map((text) => keyPackage(text, own, now));
  const lastResort =
    body.lastResort === undefined ? undefined : keyPackage(body.lastResort, own, now);
  if (packages.includes(null) || lastResort === null) return null;
  if ((await held(env, deviceId)) + packages.length > MAX_HELD) return null;

  const insert = db(env).prepare(
    `INSERT INTO key_packages (device_id, key_package, last_resort, created_at, not_after)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const statements = packages.map((p) => insert.bind(deviceId, p!.bytes, 0, now, p!.notAfter));
  if (lastResort) {
    statements.push(
      db(env)
        .prepare("DELETE FROM key_packages WHERE device_id = ? AND last_resort = 1")
        .bind(deviceId),
      insert.bind(deviceId, lastResort.bytes, 1, now, lastResort.notAfter),
    );
  }
  if (statements.length) await db(env).batch(statements);
  return stock(env, deviceId, now);
}

/** Deletes every expired package, last resorts included; the daily cron's (0029). */
export async function expireKeyPackages(env: Env, now = Date.now()): Promise<number> {
  const { meta } = await db(env)
    .prepare(`DELETE FROM key_packages WHERE ${EXPIRES} <= ?`)
    .bind(now)
    .run();
  return meta.changes;
}

type Claimed = { deviceId: string; keyPackage: Uint8Array };

/**
 * One package for each active device of the account but the caller's,
 * consumed in the same batch that reads it: a device adding its own account
 * is already in the group. A device with none left gives its last resort,
 * which stays. Only packages valid for CLAIM_MARGIN_MS more are handed out,
 * and a device with none is left out. "none" when the account has no active
 * device at all, "expired" when no other device has a valid package.
 */
export async function claim(
  env: Env,
  accountId: string,
  caller: string,
  now = Date.now(),
): Promise<Claimed[] | "none" | "expired"> {
  const { results: devices } = await db(env)
    .prepare(
      "SELECT device_id AS deviceId FROM devices WHERE account_id = ? AND revoked_at IS NULL ORDER BY device_id",
    )
    .bind(accountId)
    .all<{ deviceId: string }>();
  if (!devices.length) return "none";
  const others = devices.filter(({ deviceId }) => deviceId !== caller);
  if (!others.length) return [];

  const take = db(env).prepare(
    `DELETE FROM key_packages WHERE id = (
       SELECT id FROM key_packages
        WHERE device_id = ? AND last_resort = 0 AND ${EXPIRES} > ? ORDER BY id LIMIT 1)
     RETURNING device_id AS deviceId, key_package AS keyPackage`,
  );
  const fallback = db(env).prepare(
    `SELECT device_id AS deviceId, key_package AS keyPackage
       FROM key_packages WHERE device_id = ? AND last_resort = 1 AND ${EXPIRES} > ?`,
  );
  const valid = now + CLAIM_MARGIN_MS;
  const results = await db(env).batch<{ deviceId: string; keyPackage: ArrayBuffer | number[] }>(
    others.flatMap(({ deviceId }) => [take.bind(deviceId, valid), fallback.bind(deviceId, valid)]),
  );

  const claimed: Claimed[] = [];
  for (let i = 0; i < results.length; i += 2) {
    const row = results[i]!.results[0] ?? results[i + 1]!.results[0];
    if (row) claimed.push({ deviceId: row.deviceId, keyPackage: new Uint8Array(row.keyPackage) });
  }
  return claimed.length ? claimed : "expired";
}
