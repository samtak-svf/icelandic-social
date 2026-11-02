import { db, mediaBucket } from "../../env/index.ts";
import { toHex } from "../../shared/bytes.ts";
import { keyOf, MAX_IMPORTED_IMAGES } from "./core.ts";
import { FILE_MS } from "./file.ts";
import { loadImage, type ScrapedItem } from "./scrape.ts";

// A connection's first collection goes through the same preview as a file (decision
// 0120): the same rows, read and published by the same routes. Only the images differ:
// a source address expires within hours and a preview may wait for days, so the bytes
// are stored under the import's key now, and deleted with it.

/** The row the preview hangs on: a file import with no upload. */
export const openPreview = (env: Env, importId: string, now = Date.now()) =>
  db(env)
    .prepare(
      `INSERT OR IGNORE INTO import_files (import_id, upload_id, size, state, created_at, expires_at)
       VALUES (?, '', 0, 'parsing', ?, ?)`,
    )
    .bind(importId, now, now + FILE_MS)
    .run();

/** A fixed length and alphabet, whatever the provider uses for a post's id. */
async function keyPart(id: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
  return toHex(new Uint8Array(digest));
}

/** Stores a post's images and writes its preview row; repeating it changes nothing. */
export async function stageItem(env: Env, importId: string, item: ScrapedItem): Promise<void> {
  const part = await keyPart(item.id);
  const images: string[] = [];
  for (const [at, url] of item.images.slice(0, MAX_IMPORTED_IMAGES).entries()) {
    const bytes = await loadImage(url);
    if (bytes.byteLength === 0) continue;
    const key = `${keyOf(importId)}/${part}/${at}`;
    await mediaBucket(env).put(key, bytes);
    images.push(key);
  }
  if (item.body.trim() === "" && images.length === 0 && !item.videoLink) return;
  await db(env)
    .prepare(
      `INSERT OR IGNORE INTO import_file_items (import_id, item_id, at, body, images, has_video, link)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      importId,
      item.id,
      item.createdAt,
      item.body,
      JSON.stringify(images),
      item.videoLink ? 1 : 0,
      item.videoLink,
    )
    .run();
}

/** How many posts the first collection holds to choose from, and when the newest was written. */
export async function stagedPosts(
  env: Env,
  importId: string,
): Promise<{ posts: number; latest: number }> {
  const staged = await db(env)
    .prepare(
      "SELECT COUNT(*) AS posts, COALESCE(MAX(at), 0) AS latest FROM import_file_items WHERE import_id = ?",
    )
    .bind(importId)
    .first<{ posts: number; latest: number }>();
  return staged ?? { posts: 0, latest: 0 };
}
