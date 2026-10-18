import { db, images, socialBucket } from "../../env/index.ts";
import { log } from "../../log.ts";
import type { MediaRef } from "./do/space.ts";
import { mediaKey } from "./posts.ts";

// The images of posts (decision 0065): validated and re-encoded by the
// server to a WebP no larger than 2048 pixels a side, without metadata, kept
// in spjall-profiles under social/<community>/<image>. Only an image format
// Images decodes to pixels is taken, so no SVG, no script, no other file.

/** The longest side a stored image has. */
const MAX_SIDE = 2048;

/** The upload formats taken; anything else, SVG above all, is refused. */
const TAKEN = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

/** An image no post took is deleted after this long. */
const UNATTACHED_MS = 24 * 60 * 60 * 1000;

const newMediaId = () =>
  `sm_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

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
    if (!TAKEN.has(info.format) || !("width" in info)) return "invalid_image";
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

/** An image of `postId`, or null when the post holds no such image. */
export async function postImage(
  env: Env,
  communityId: string,
  postId: string,
  mediaId: string,
): Promise<R2ObjectBody | null> {
  const row = await db(env)
    .prepare("SELECT 1 FROM social_media WHERE media_id = ? AND post_id = ? AND community_id = ?")
    .bind(mediaId, postId, communityId)
    .first();
  return row ? socialBucket(env).get(mediaKey(communityId, mediaId)) : null;
}

/** Deletes the images under `keys`. */
export async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  // R2 deletes at most 1000 keys a call.
  for (let at = 0; at < keys.length; at += 1000) {
    await socialBucket(env).delete(keys.slice(at, at + 1000));
  }
}

/** Deletes a community's every image, rows aside (they go with the community). */
export async function deleteCommunityMedia(env: Env, communityId: string): Promise<void> {
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
