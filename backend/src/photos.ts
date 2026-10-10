import type { OpenAPIHono } from "@hono/zod-openapi";
import { base64url } from "./bytes.ts";
import {
  deletePhotoRoute,
  getPhotoRoute,
  MAX_PHOTO_UPLOAD,
  putPhotoRoute,
} from "./api/accounts.ts";
import type { AppEnv } from "./app.ts";
import { UNBLOCKED } from "./blocks.ts";
import { db, images, profilesBucket, withinLimit } from "./env/index.ts";
import { fail } from "./errors.ts";
import { log } from "./log.ts";

// The profile photo (decision 0039): one per account, shown to every signed-in
// account but those a block stands between, and not end-to-end encrypted. The
// Worker re-encodes every upload through Cloudflare Images to one size of WebP
// without metadata, and keeps only that, in spjall-profiles keyed by account
// id. A log line says a photo was set or removed, with the account id and a
// size, never the image or its version (0008).

/** The one size every photo is stored at: a square this many pixels a side. */
const PHOTO_SIDE = 512;

/**
 * Re-encodes an upload of `size` bytes to the stored WebP. Throws when the
 * body is not `size` bytes long; "invalid_image" when Images cannot decode it.
 */
async function reencode(
  env: Env,
  body: ReadableStream<Uint8Array>,
  size: number,
): Promise<ArrayBuffer | "invalid_image"> {
  const { readable, writable } = new FixedLengthStream(size);
  const [piped, encoded] = await Promise.allSettled([
    body.pipeTo(writable),
    images(env)
      .input(readable)
      .transform({ width: PHOTO_SIDE, height: PHOTO_SIDE, fit: "cover" })
      .output({ format: "image/webp" })
      .then((result) => result.response().arrayBuffer()),
  ]);
  if (piped.status === "rejected") throw piped.reason;
  if (encoded.status === "rejected") {
    const code = (encoded.reason as { code?: unknown } | null)?.code;
    log("photo.refused", { code: typeof code === "number" ? `images_${code}` : "images" });
    return "invalid_image";
  }
  return encoded.value;
}

/**
 * Stores `accountId`'s photo, replacing any it had, and gives it a new
 * version. The object first, then the version, so no version names a photo
 * that is not there yet.
 */
async function setPhoto(
  env: Env,
  accountId: string,
  body: ReadableStream<Uint8Array>,
  size: number,
): Promise<{ version: string; size: number } | "invalid_image"> {
  const webp = await reencode(env, body, size);
  if (webp === "invalid_image") return webp;
  await profilesBucket(env).put(accountId, webp, { httpMetadata: { contentType: "image/webp" } });
  const version = `ph_${base64url(crypto.getRandomValues(new Uint8Array(16)))}`;
  const updated = await db(env)
    .prepare("UPDATE accounts SET photo_version = ? WHERE account_id = ?")
    .bind(version, accountId)
    .run();
  // The account was deleted while the photo was on its way: keep nothing.
  if (updated.meta.changes === 0) await deleteAccountPhoto(env, accountId);
  return { version, size: webp.byteLength };
}

/** Removes `accountId`'s photo: the version first, so none names a missing photo. */
async function removePhoto(env: Env, accountId: string): Promise<void> {
  await db(env)
    .prepare("UPDATE accounts SET photo_version = NULL WHERE account_id = ?")
    .bind(accountId)
    .run();
  await deleteAccountPhoto(env, accountId);
}

/** Deletes the stored photo, if any (`DELETE /v1/me`, decision 0039). */
export async function deleteAccountPhoto(env: Env, accountId: string): Promise<void> {
  await profilesBucket(env).delete(accountId);
}

/**
 * `owner`'s photo as `viewer` may see it: null when there is none, no such
 * account, or a block between the two, which all answer alike so the answer
 * does not say who blocked whom.
 */
async function photoFor(env: Env, viewer: string, owner: string): Promise<R2ObjectBody | null> {
  const row = await db(env)
    .prepare(
      `SELECT 1 FROM accounts WHERE account_id = ?2 AND photo_version IS NOT NULL
          AND ${UNBLOCKED("?1", "?2")}`,
    )
    .bind(viewer, owner)
    .first();
  return row ? profilesBucket(env).get(owner) : null;
}

export function photoRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(putPhotoRoute, async (c) => {
    const { accountId } = c.var.device;
    const body = c.req.raw.body;
    // A refusal cancels the body, so the client stops sending it.
    const refuse = async <T>(answer: T) => (await body?.cancel(), answer);
    if (!(await withinLimit(c.env, "photos", accountId))) {
      log("request.rate_limited", { code: "photos", requestId: c.var.requestId });
      return refuse(fail(c, 429, "rate_limited"));
    }
    const length = Number(c.req.header("content-length") ?? Number.NaN);
    if (!Number.isSafeInteger(length) || length < 1 || !body) {
      return refuse(fail(c, 400, "invalid_request"));
    }
    if (length > MAX_PHOTO_UPLOAD) return refuse(fail(c, 413, "too_large"));
    let stored: Awaited<ReturnType<typeof setPhoto>>;
    try {
      stored = await setPhoto(c.env, accountId, body, length);
    } catch {
      // The body ended short of, or ran past, its Content-Length.
      return fail(c, 400, "invalid_request");
    }
    if (stored === "invalid_image") return fail(c, 400, "invalid_image");
    log("photo.set", { accountId, size: stored.size });
    return c.json({ photo: stored.version }, 200);
  });

  app.openapi(deletePhotoRoute, async (c) => {
    const { accountId } = c.var.device;
    await removePhoto(c.env, accountId);
    log("photo.removed", { accountId });
    return c.body(null, 204);
  });

  app.openapi(getPhotoRoute, async (c) => {
    const owner = c.req.valid("param").accountId;
    const object = await photoFor(c.env, c.var.device.accountId, owner);
    if (!object) return fail(c, 404, "not_found");
    return c.body(object.body, 200, {
      "content-type": "image/webp",
      "content-length": String(object.size),
    });
  });
}
