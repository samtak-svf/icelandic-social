import { db, profilesBucket } from "../../env/index.ts";

// A group's photo (decision 0094): the core's ciphertext in spjall-profiles
// under `groups/<conversationId>/<mediaId>`, which has no lifecycle rule, so
// it lives as long as the group has it. One per conversation, recorded in D1.

/** The largest ciphertext of a group photo: 1 MB. */
export const MAX_GROUP_PHOTO = 1_048_576;

const key = (conversationId: string, mediaId: string) => `groups/${conversationId}/${mediaId}`;

/**
 * Stores the photo and makes it the conversation's, deleting the one it
 * replaces. The object first, then the row, so no row names a missing object.
 * The stream must carry exactly `size` bytes, or nothing is kept.
 */
export async function putGroupPhoto(
  env: Env,
  conversationId: string,
  mediaId: string,
  size: number,
  body: ReadableStream<Uint8Array>,
): Promise<void> {
  const previous = await db(env)
    .prepare("SELECT media_id FROM group_photos WHERE conversation_id = ?")
    .bind(conversationId)
    .first<{ media_id: string }>();
  const { readable, writable } = new FixedLengthStream(size);
  const bucket = profilesBucket(env);
  const target = key(conversationId, mediaId);
  try {
    await Promise.all([body.pipeTo(writable), bucket.put(target, readable)]);
  } catch (error) {
    // A short or long body leaves nothing, unless this id was already the photo.
    if (previous?.media_id !== mediaId) await bucket.delete(target);
    throw error;
  }
  await db(env)
    .prepare(
      `INSERT INTO group_photos (conversation_id, media_id, size, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (conversation_id) DO UPDATE SET
         media_id = excluded.media_id, size = excluded.size, updated_at = excluded.updated_at`,
    )
    .bind(conversationId, mediaId, size, Date.now())
    .run();
  if (previous && previous.media_id !== mediaId) {
    await bucket.delete(key(conversationId, previous.media_id));
  }
}

/** The photo's bytes, if `mediaId` is the conversation's current photo. */
export async function getGroupPhoto(
  env: Env,
  conversationId: string,
  mediaId: string,
): Promise<R2ObjectBody | null> {
  const row = await db(env)
    .prepare("SELECT 1 FROM group_photos WHERE conversation_id = ? AND media_id = ?")
    .bind(conversationId, mediaId)
    .first();
  return row ? profilesBucket(env).get(key(conversationId, mediaId)) : null;
}

/** Deletes the conversation's photo, if any: the row first, then the object. */
export async function deleteGroupPhoto(env: Env, conversationId: string): Promise<void> {
  const row = await db(env)
    .prepare("DELETE FROM group_photos WHERE conversation_id = ? RETURNING media_id")
    .bind(conversationId)
    .first<{ media_id: string }>();
  if (row) await profilesBucket(env).delete(key(conversationId, row.media_id));
}
