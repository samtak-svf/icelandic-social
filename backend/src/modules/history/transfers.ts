import { db, mediaBucket } from "../../env/index.ts";
import { type ApprovedLink, approvedLink, type Device } from "../../identity/index.ts";

// History from a sibling device (decision 0064, #300). The core seals the
// history to the link's one-time X25519 key, so the Worker stores and hands
// out opaque bytes, and checks only who may: the phone that approved the link
// uploads, the device the link made downloads. The bytes are in the EU media
// bucket under `history/<linkId>`, uploaded with R2 multipart since a Worker
// request body is far smaller than a history.

/** The most history the core sends: 1 GiB of plaintext (core/client/src/history.rs). */
const MAX_HISTORY = 1024 * 1024 * 1024;

/** The core seals in segments of this many bytes, each with a 16-byte tag. */
const SEGMENT = 64 * 1024;

/** Magic, version and the HPKE encapsulation ahead of the sealed stream. */
const HEADER = 4 + 1 + 32;

/** The largest ciphertext of a history within MAX_HISTORY, an empty last segment included. */
export const MAX_HISTORY_CIPHERTEXT =
  HEADER + MAX_HISTORY + 16 * (Math.ceil(MAX_HISTORY / SEGMENT) + 1);

/** Every part but the last; R2 wants them equal, and a Worker takes a body this size. */
export const PART_SIZE = 64 * 1024 * 1024;

/** A transfer is deleted this long after it starts, if the linked device has not deleted it. */
export const TRANSFER_MS = 24 * 60 * 60 * 1000;

type Transfer = {
  accountId: string;
  uploaderDeviceId: string;
  uploadId: string;
  size: number;
  expiresAt: number;
  completedAt: number | null;
};

const keyOf = (linkId: string) => `history/${linkId}`;

/** How many parts a ciphertext of `size` bytes takes. */
const partsOf = (size: number) => Math.ceil(size / PART_SIZE);

/** The length of part `part` (from 1) of a ciphertext of `size` bytes, or 0 for no such part. */
function partLength(size: number, part: number): number {
  const parts = partsOf(size);
  if (part > parts) return 0;
  return part < parts ? PART_SIZE : size - PART_SIZE * (parts - 1);
}

async function transferOf(env: Env, linkId: string): Promise<Transfer | null> {
  return db(env)
    .prepare(
      `SELECT account_id AS accountId, uploader_device_id AS uploaderDeviceId,
              upload_id AS uploadId, size, expires_at AS expiresAt, completed_at AS completedAt
         FROM history_transfers WHERE link_id = ?`,
    )
    .bind(linkId)
    .first<Transfer>();
}

const isUploader = (transfer: Transfer, device: Device) =>
  transfer.uploaderDeviceId === device.deviceId && transfer.accountId === device.accountId;

const isRecipient = (link: ApprovedLink, device: Device) =>
  link.deviceId === device.deviceId && link.accountId === device.accountId;

/** Why a transfer call was refused; each route answers only its own. */
type Refused = "not_found" | "not_this_device";

/**
 * Starts a transfer on `linkId` for the phone that approved it, within a day
 * of the approval: the D1 row first, which takes the link, then the upload.
 */
export async function createTransfer(
  env: Env,
  device: Device,
  linkId: string,
  size: number,
  now = Date.now(),
): Promise<
  | { ok: { partSize: number; parts: number; expiresAt: number } }
  | { error: Refused | "conflict" | "too_large" }
> {
  if (size > MAX_HISTORY_CIPHERTEXT) return { error: "too_large" };
  const link = await approvedLink(env, linkId, now);
  if (!link || link.approvedAt + TRANSFER_MS <= now) return { error: "not_found" };
  if (link.approvedBy !== device.deviceId || link.accountId !== device.accountId) {
    return { error: "not_this_device" };
  }
  const expiresAt = now + TRANSFER_MS;
  const taken = await db(env)
    .prepare(
      `INSERT INTO history_transfers
         (link_id, account_id, uploader_device_id, upload_id, size, created_at, expires_at)
       VALUES (?, ?, ?, '', ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(linkId, device.accountId, device.deviceId, size, now, expiresAt)
    .run();
  if (taken.meta.changes === 0) return { error: "conflict" };
  try {
    const upload = await mediaBucket(env).createMultipartUpload(keyOf(linkId));
    await db(env)
      .prepare("UPDATE history_transfers SET upload_id = ? WHERE link_id = ?")
      .bind(upload.uploadId, linkId)
      .run();
  } catch (error) {
    await db(env).prepare("DELETE FROM history_transfers WHERE link_id = ?").bind(linkId).run();
    throw error;
  }
  return { ok: { partSize: PART_SIZE, parts: partsOf(size), expiresAt } };
}

/**
 * Stores part `part` of the uploader's transfer. The stream must carry
 * exactly the part's length; a repeated part replaces the one before it.
 */
export async function putPart(
  env: Env,
  device: Device,
  linkId: string,
  part: number,
  length: number,
  body: ReadableStream<Uint8Array>,
  now = Date.now(),
): Promise<"ok" | Refused | "expired" | "conflict" | "invalid_request"> {
  const transfer = await transferOf(env, linkId);
  if (!transfer) return "not_found";
  if (!isUploader(transfer, device)) return "not_this_device";
  if (transfer.expiresAt <= now) return "expired";
  if (transfer.completedAt !== null) return "conflict";
  const expected = partLength(transfer.size, part);
  if (expected === 0 || length !== expected) return "invalid_request";
  const upload = mediaBucket(env).resumeMultipartUpload(keyOf(linkId), transfer.uploadId);
  const { readable, writable } = new FixedLengthStream(length);
  const [, uploaded] = await Promise.all([
    body.pipeTo(writable),
    upload.uploadPart(part, readable),
  ]);
  await db(env)
    .prepare(
      `INSERT INTO history_transfer_parts (link_id, part_number, etag) VALUES (?, ?, ?)
       ON CONFLICT (link_id, part_number) DO UPDATE SET etag = excluded.etag`,
    )
    .bind(linkId, part, uploaded.etag)
    .run();
  return "ok";
}

/** Completes the uploader's transfer once every part is stored. */
export async function completeTransfer(
  env: Env,
  device: Device,
  linkId: string,
  now = Date.now(),
): Promise<"ok" | Refused | "expired" | "conflict" | "incomplete"> {
  const transfer = await transferOf(env, linkId);
  if (!transfer) return "not_found";
  if (!isUploader(transfer, device)) return "not_this_device";
  if (transfer.expiresAt <= now) return "expired";
  if (transfer.completedAt !== null) return "conflict";
  const { results } = await db(env)
    .prepare(
      `SELECT part_number AS partNumber, etag FROM history_transfer_parts
        WHERE link_id = ? ORDER BY part_number`,
    )
    .bind(linkId)
    .all<{ partNumber: number; etag: string }>();
  if (results.length !== partsOf(transfer.size)) return "incomplete";
  await mediaBucket(env).resumeMultipartUpload(keyOf(linkId), transfer.uploadId).complete(results);
  await db(env).batch([
    db(env)
      .prepare("UPDATE history_transfers SET completed_at = ? WHERE link_id = ?")
      .bind(now, linkId),
    db(env).prepare("DELETE FROM history_transfer_parts WHERE link_id = ?").bind(linkId),
  ]);
  return "ok";
}

/** The completed transfer's bytes, for the device the link made. */
export async function getTransfer(
  env: Env,
  device: Device,
  linkId: string,
  now = Date.now(),
): Promise<{ ok: R2ObjectBody } | { error: Refused | "expired" }> {
  const link = await approvedLink(env, linkId, now);
  if (!link) return { error: "not_found" };
  if (!isRecipient(link, device)) return { error: "not_this_device" };
  const transfer = await transferOf(env, linkId);
  if (!transfer || transfer.completedAt === null) return { error: "not_found" };
  if (transfer.expiresAt <= now) return { error: "expired" };
  const object = await mediaBucket(env).get(keyOf(linkId));
  return object ? { ok: object } : { error: "not_found" };
}

/**
 * Deletes the transfer on `linkId`: by the device the link made once it has
 * the history, or by the phone that uploads it, to cancel.
 */
export async function deleteTransfer(
  env: Env,
  device: Device,
  linkId: string,
  now = Date.now(),
): Promise<"ok" | Refused> {
  const transfer = await transferOf(env, linkId);
  if (transfer && isUploader(transfer, device)) {
    await drop(env, linkId, transfer);
    return "ok";
  }
  const link = await approvedLink(env, linkId, now);
  if (!link) return "not_found";
  if (!isRecipient(link, device)) return "not_this_device";
  if (transfer) await drop(env, linkId, transfer);
  return "ok";
}

/** Removes a transfer's bytes, finished or not, then its row and parts. */
async function drop(env: Env, linkId: string, transfer: Transfer): Promise<void> {
  if (transfer.completedAt !== null) {
    await mediaBucket(env).delete(keyOf(linkId));
  } else if (transfer.uploadId) {
    try {
      await mediaBucket(env).resumeMultipartUpload(keyOf(linkId), transfer.uploadId).abort();
    } catch {
      // An upload R2 no longer knows has nothing left to abort.
    }
  }
  await db(env).prepare("DELETE FROM history_transfers WHERE link_id = ?").bind(linkId).run();
}

async function dropWhere(env: Env, where: string, value: string | number): Promise<number> {
  const { results } = await db(env)
    .prepare(
      `SELECT link_id AS linkId, account_id AS accountId, uploader_device_id AS uploaderDeviceId,
              upload_id AS uploadId, size, expires_at AS expiresAt, completed_at AS completedAt
         FROM history_transfers WHERE ${where}`,
    )
    .bind(value)
    .all<Transfer & { linkId: string }>();
  for (const transfer of results) await drop(env, transfer.linkId, transfer);
  return results.length;
}

/** Deletes the transfers past their 24 hours, bytes first (decision 0064). */
export function expireHistory(env: Env, now = Date.now()): Promise<number> {
  return dropWhere(env, "expires_at <= ?", now);
}

/** Deletes every transfer of an account (decision 0014, `DELETE /v1/me`). */
export function deleteAccountHistory(env: Env, accountId: string): Promise<number> {
  return dropWhere(env, "account_id = ?", accountId);
}
