import { db, mediaBucket } from "./env/index.ts";

// Photos and files as encrypted blobs in R2 (decision 0023). The core
// encrypts before upload and the key stays inside MLS, so the Worker stores
// and hands out opaque bytes, and checks only who may.

/** The largest file the core sends: 25 MB of plaintext. */
const MAX_PLAINTEXT = 25 * 1024 * 1024;

/** The core seals a file in segments of this many bytes, each with a 16-byte tag. */
const SEGMENT = 64 * 1024;

/** The largest ciphertext of a file within MAX_PLAINTEXT. */
export const MAX_CIPHERTEXT = MAX_PLAINTEXT + 16 * Math.ceil(MAX_PLAINTEXT / SEGMENT);

/** Objects are deleted this long after upload, the retention of messages (decision 0015). */
export const MEDIA_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** R2 deletes at most this many keys in one call. */
const DELETE_BATCH = 1000;

type Upload = {
  mediaId: string;
  conversationId: string;
  accountId: string;
  size: number;
  body: ReadableStream<Uint8Array>;
};

/**
 * Stores an object: the D1 row first, which takes the id, then the bytes.
 * The stream must carry exactly `size` bytes, or nothing is kept.
 */
export async function putMedia(env: Env, upload: Upload): Promise<"ok" | "conflict"> {
  const taken = await db(env)
    .prepare(
      `INSERT INTO media (media_id, conversation_id, uploader_account_id, size, created_at)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .bind(upload.mediaId, upload.conversationId, upload.accountId, upload.size, Date.now())
    .run();
  if (taken.meta.changes === 0) return "conflict";
  const { readable, writable } = new FixedLengthStream(upload.size);
  try {
    await Promise.all([
      upload.body.pipeTo(writable),
      mediaBucket(env).put(upload.mediaId, readable),
    ]);
  } catch (error) {
    await db(env).prepare("DELETE FROM media WHERE media_id = ?").bind(upload.mediaId).run();
    throw error;
  }
  return "ok";
}

/** The object's bytes, if it exists and belongs to this conversation. */
export async function getMedia(
  env: Env,
  conversationId: string,
  mediaId: string,
): Promise<R2ObjectBody | null> {
  const row = await db(env)
    .prepare("SELECT 1 FROM media WHERE media_id = ? AND conversation_id = ?")
    .bind(mediaId, conversationId)
    .first();
  return row ? mediaBucket(env).get(mediaId) : null;
}

async function deleteWhere(env: Env, where: string, value: string | number): Promise<number> {
  let deleted = 0;
  for (;;) {
    const { results } = await db(env)
      .prepare(`SELECT media_id AS id FROM media WHERE ${where} LIMIT ${DELETE_BATCH}`)
      .bind(value)
      .all<{ id: string }>();
    if (!results.length) return deleted;
    const ids = results.map((r) => r.id);
    await mediaBucket(env).delete(ids);
    await db(env)
      .prepare("DELETE FROM media WHERE media_id IN (SELECT value FROM json_each(?))")
      .bind(JSON.stringify(ids))
      .run();
    deleted += ids.length;
  }
}

/** Deletes the objects older than the retention, bytes first. */
export function expireMedia(env: Env, now = Date.now()): Promise<number> {
  return deleteWhere(env, "created_at < ?", now - MEDIA_RETENTION_MS);
}

/** Deletes every object an account uploaded (decision 0014, `DELETE /v1/me`). */
export function deleteAccountMedia(env: Env, accountId: string): Promise<number> {
  return deleteWhere(env, "uploader_account_id = ?", accountId);
}
