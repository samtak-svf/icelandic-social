import { db, images, socialBucket } from "../../env/index.ts";
import { randomHex } from "../../shared/bytes.ts";
import {
  communityCoverKey,
  communityPictureKey,
  deleteImage,
  IMAGE_TYPES,
} from "../../shared/images.ts";
import { log } from "../../shared/log.ts";
import type { MediaRef } from "./do/space.ts";
import { REMOVED_KEPT_MS } from "./do/space-schema.ts";
import { parseCursor } from "./post-page.ts";
import { mediaKey } from "./posts.ts";

// The images of posts (decision 0065): validated and re-encoded by the
// server to a WebP no larger than 2048 pixels a side, without metadata, kept
// in spjall-profiles under social/<community>/<image>. Only an image format
// Images decodes to pixels is taken, so no SVG, no script, no other file.

/** The longest side a stored image has. */
const MAX_SIDE = 2048;

/** An image no post took is deleted after this long. */
const UNATTACHED_MS = 24 * 60 * 60 * 1000;

const newMediaId = () => `sm_${randomHex(16)}`;

/** Reads exactly `size` bytes of `body`; throws when it is shorter or longer. */
async function readExactly(body: ReadableStream<Uint8Array>, size: number): Promise<ArrayBuffer> {
  const { readable, writable } = new FixedLengthStream(size);
  const [piped, read] = await Promise.allSettled([
    body.pipeTo(writable),
    new Response(readable).arrayBuffer(),
  ]);
  if (piped.status === "rejected") throw piped.reason;
  if (read.status === "rejected") throw read.reason;
  return read.value;
}

/** The re-encoded image and its size, or "invalid_image". */
async function reencode(
  env: Env,
  bytes: ArrayBuffer,
): Promise<{ webp: ArrayBuffer; width: number; height: number } | "invalid_image"> {
  try {
    const info = await images(env).info(new Blob([bytes]).stream());
    if (!IMAGE_TYPES.has(info.format) || !("width" in info)) return "invalid_image";
    const encoded = await images(env)
      .input(new Blob([bytes]).stream())
      .transform({ width: MAX_SIDE, height: MAX_SIDE, fit: "scale-down" })
      .output({ format: "image/webp" });
    const webp = await encoded.response().arrayBuffer();
    const out = await images(env).info(new Blob([webp]).stream());
    if (!("width" in out)) return "invalid_image";
    return { webp, width: out.width, height: out.height };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    log("social_media.refused", { code: typeof code === "number" ? `images_${code}` : "images" });
    return "invalid_image";
  }
}

/**
 * Stores an upload of `size` bytes for a post in `communityId`. Throws when
 * the body is not `size` bytes long.
 */
export async function upload(
  env: Env,
  communityId: string,
  uploader: string,
  body: ReadableStream<Uint8Array>,
  size: number,
): Promise<MediaRef | "invalid_image"> {
  const encoded = await reencode(env, await readExactly(body, size));
  if (encoded === "invalid_image") return encoded;
  const mediaId = newMediaId();
  await socialBucket(env).put(mediaKey(communityId, mediaId), encoded.webp, {
    httpMetadata: { contentType: "image/webp" },
  });
  await db(env)
    .prepare(
      `INSERT INTO social_media
         (media_id, community_id, uploader_id, width, height, size, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      mediaId,
      communityId,
      uploader,
      encoded.width,
      encoded.height,
      encoded.webp.byteLength,
      Date.now(),
    )
    .run();
  return { mediaId, width: encoded.width, height: encoded.height };
}

/**
 * The image of `postId` named `mediaId`: the comment that carries it, or null
 * for a post's own image; undefined when the post holds no such image.
 */
export async function postImageOwner(
  env: Env,
  communityId: string,
  postId: string,
  mediaId: string,
): Promise<{ commentId: string | null } | undefined> {
  const row = await db(env)
    .prepare(
      `SELECT comment_id AS commentId FROM social_media
        WHERE media_id = ? AND post_id = ? AND community_id = ?`,
    )
    .bind(mediaId, postId, communityId)
    .first<{ commentId: string | null }>();
  return row ?? undefined;
}

/** The stored image `mediaId` of `communityId`, once the caller has checked who may read it. */
export const readImage = (env: Env, communityId: string, mediaId: string) =>
  socialBucket(env).get(mediaKey(communityId, mediaId));

/** One image of the community's images tab (decision 0089). */
export type CommunityImage = {
  mediaId: string;
  postId: string;
  commentId: string | null;
  width: number;
  height: number;
  createdAt: number;
};

/**
 * The images of a community's visible posts and of their comments that stand,
 * newest first, but those of an account `hidden` names (a block, decision
 * 0063). Keyset pagination on (created_at, media_id), like the feed's. With
 * `everyoneOnly`, only those of the wall posts anyone may read (decision 0115).
 */
export async function communityImages(
  env: Env,
  communityId: string,
  hidden: string[],
  cursor: string | undefined,
  limit: number,
  everyoneOnly = false,
): Promise<{ rows: CommunityImage[]; next: string | null }> {
  const at = parseCursor(cursor);
  const { results } = await db(env)
    .prepare(
      `SELECT m.media_id AS mediaId, m.post_id AS postId, m.comment_id AS commentId,
              m.width, m.height, m.created_at AS createdAt
         FROM social_media m JOIN post_index p ON p.post_id = m.post_id
        WHERE m.community_id = ?1 AND m.post_id IS NOT NULL AND p.state = 'visible'
          AND m.removed_at IS NULL AND m.hidden_at IS NULL
          AND m.uploader_id NOT IN (SELECT value FROM json_each(?2))
          AND p.author_id NOT IN (SELECT value FROM json_each(?2))
          AND (?3 IS NULL OR m.created_at < ?3
               OR (m.created_at = ?3 AND (?4 IS NULL OR m.media_id < ?4)))
          AND (?6 = 0 OR p.audience = 'everyone')
        ORDER BY m.created_at DESC, m.media_id DESC LIMIT ?5`,
    )
    .bind(
      communityId,
      JSON.stringify(hidden),
      at?.t ?? null,
      at?.id ?? null,
      limit + 1,
      everyoneOnly ? 1 : 0,
    )
    .all<CommunityImage>();
  const rows = results.slice(0, limit);
  const last = rows.at(-1);
  return {
    rows,
    next: results.length > limit && last ? `${last.createdAt}-${last.mediaId}` : null,
  };
}

/** The ids of a post's own images, its comments' left out. */
export async function postMedia(env: Env, postId: string): Promise<string[]> {
  const { results } = await db(env)
    .prepare("SELECT media_id AS id FROM social_media WHERE post_id = ? AND comment_id IS NULL")
    .bind(postId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/**
 * The images comments carry (decision 0082), by comment id, one query for any
 * number of comments. A comment without one has no entry.
 */
export async function commentMedia(
  env: Env,
  commentIds: string[],
): Promise<Map<string, MediaRef[]>> {
  const found = new Map<string, MediaRef[]>();
  if (commentIds.length === 0) return found;
  const { results } = await db(env)
    .prepare(
      `SELECT comment_id AS commentId, media_id AS mediaId, width, height FROM social_media
        WHERE comment_id IN (SELECT value FROM json_each(?)) ORDER BY created_at, media_id`,
    )
    .bind(JSON.stringify(commentIds))
    .all<MediaRef & { commentId: string }>();
  for (const { commentId, ...ref } of results)
    found.set(commentId, [...(found.get(commentId) ?? []), ref]);
  return found;
}

/**
 * Deletes the images comments carry once their comment was removed
 * REMOVED_KEPT_MS before `now`, the window in which the space deletes the
 * comment's text (decision 0082); the number deleted.
 */
export async function purgeRemovedCommentMedia(env: Env, now: number): Promise<number> {
  const { results } = await db(env)
    .prepare(
      `DELETE FROM social_media WHERE removed_at IS NOT NULL AND removed_at <= ?
        RETURNING community_id, media_id`,
    )
    .bind(now - REMOVED_KEPT_MS)
    .all<{ community_id: string; media_id: string }>();
  await deleteKeys(
    env,
    results.map((r) => mediaKey(r.community_id, r.media_id)),
  );
  return results.length;
}

/** Deletes the image of `commentId` (its author's delete): row and object, in the same request. */
export async function deleteCommentMedia(env: Env, commentId: string): Promise<void> {
  const { results } = await db(env)
    .prepare("DELETE FROM social_media WHERE comment_id = ? RETURNING community_id, media_id")
    .bind(commentId)
    .all<{ community_id: string; media_id: string }>();
  await deleteKeys(
    env,
    results.map((r) => mediaKey(r.community_id, r.media_id)),
  );
}

/**
 * Deletes every comment image `accountId` uploaded, in other people's posts
 * too (decision 0082); called before the account's rows go.
 */
export async function deleteCommentMediaOf(env: Env, accountId: string): Promise<void> {
  const { results } = await db(env)
    .prepare(
      `DELETE FROM social_media WHERE uploader_id = ? AND comment_id IS NOT NULL
        RETURNING community_id, media_id`,
    )
    .bind(accountId)
    .all<{ community_id: string; media_id: string }>();
  await deleteKeys(
    env,
    results.map((r) => mediaKey(r.community_id, r.media_id)),
  );
}

/** Deletes the images under `keys`. */
export async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  // R2 deletes at most 1000 keys a call.
  for (let at = 0; at < keys.length; at += 1000) {
    await socialBucket(env).delete(keys.slice(at, at + 1000));
  }
}

/**
 * Deletes a community's every image, rows aside (they go with the community):
 * its posts' images, and its picture and cover (decision 0080).
 */
export async function deleteCommunityMedia(env: Env, communityId: string): Promise<void> {
  await deleteImage(env, communityPictureKey(communityId), "photo");
  await deleteImage(env, communityCoverKey(communityId), "cover");
  const prefix = `social/${communityId}/`;
  let cursor: string | undefined;
  do {
    const listed = await socialBucket(env).list({ prefix, cursor });
    await deleteKeys(
      env,
      listed.objects.map((o) => o.key),
    );
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/** Deletes the images uploaded where no post took them: older than a day, or `uploader`'s. */
export async function deleteUnattached(
  env: Env,
  options: { now?: number; uploader?: string },
): Promise<number> {
  const { results } = await db(env)
    .prepare(
      `DELETE FROM social_media
        WHERE post_id IS NULL AND (?1 IS NULL OR created_at < ?1) AND (?2 IS NULL OR uploader_id = ?2)
        RETURNING community_id, media_id`,
    )
    .bind(
      options.uploader === undefined ? (options.now ?? Date.now()) - UNATTACHED_MS : null,
      options.uploader ?? null,
    )
    .all<{ community_id: string; media_id: string }>();
  await deleteKeys(
    env,
    results.map((r) => mediaKey(r.community_id, r.media_id)),
  );
  return results.length;
}
