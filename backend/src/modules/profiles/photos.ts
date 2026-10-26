import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  deletePhotoRoute,
  getPhotoRoute,
  getPhotoSourceRoute,
  MAX_PHOTO_UPLOAD,
  patchPhotoFramesRoute,
  putPhotoRoute,
} from "../../api/accounts.ts";
import { framingFits } from "../../api/image-frames.ts";
import type { AppEnv } from "../../http.ts";
import { setPhotoVersion, UNBLOCKED } from "../../identity/index.ts";
import { db, withinLimit } from "../../env/index.ts";
import { fail } from "../../shared/errors.ts";
import {
  deleteImage,
  getFrame,
  getMaster,
  imageHeaders,
  renderFrames,
  storeImage,
  takeUpload,
} from "../../shared/images.ts";
import { log } from "../../shared/log.ts";

// The profile photo (decision 0039): one per account, shown to every signed-in
// account but those a block stands between, and not end-to-end encrypted. The
// Worker re-encodes every upload through Cloudflare Images to one size of WebP
// without metadata, and keeps only that, in spjall-profiles keyed by account
// id. A log line says a photo was set or removed, with the account id and a
// size, never the image or its version (0008).

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
  const stored = await storeImage(env, accountId, "photo", body, size);
  if (stored === "invalid_image") return stored;
  // The account was deleted while the photo was on its way: keep nothing.
  if (!(await setPhotoVersion(env, accountId, stored.version, stored.framing))) {
    await deleteAccountPhoto(env, accountId);
  }
  return stored;
}

/** Removes `accountId`'s photo: the version first, so none names a missing photo. */
async function removePhoto(env: Env, accountId: string): Promise<void> {
  await setPhotoVersion(env, accountId, null, null);
  await deleteAccountPhoto(env, accountId);
}

/** Deletes the stored photo, if any (`DELETE /v1/me`, decision 0039). */
export async function deleteAccountPhoto(env: Env, accountId: string): Promise<void> {
  await deleteImage(env, accountId, "photo");
}

/**
 * `owner`'s photo as `viewer` may see it: null when there is none, no such
 * account, or a block between the two, which all answer alike so the answer
 * does not say who blocked whom.
 */
async function photoFor(
  env: Env,
  viewer: string,
  owner: string,
  frame: string | undefined,
): Promise<R2ObjectBody | null> {
  const row = await db(env)
    .prepare(
      `SELECT 1 FROM accounts WHERE account_id = ?2 AND photo_version IS NOT NULL
          AND ${UNBLOCKED("?1", "?2")}`,
    )
    .bind(viewer, owner)
    .first();
  return row ? getFrame(env, owner, "photo", frame) : null;
}

export function photoRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(putPhotoRoute, async (c) => {
    const { accountId } = c.var.session;
    const upload = await takeUpload(c, accountId, MAX_PHOTO_UPLOAD);
    if ("error" in upload) return fail(c, upload.status, upload.error);
    const { body, length } = upload;
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

  app.openapi(patchPhotoFramesRoute, async (c) => {
    const { accountId } = c.var.session;
    const framing = c.req.valid("json");
    if (!framingFits("photo", framing)) return fail(c, 400, "invalid_request");
    const row = await db(c.env)
      .prepare("SELECT 1 FROM accounts WHERE account_id = ? AND photo_version IS NOT NULL")
      .bind(accountId)
      .first();
    if (!row) return fail(c, 404, "not_found");
    if (!(await withinLimit(c.env, "photos", accountId))) {
      log("request.rate_limited", { code: "photos", requestId: c.var.requestId });
      return fail(c, 429, "rate_limited");
    }
    const rendered = await renderFrames(c.env, accountId, "photo", framing);
    if (rendered === "no_master") return fail(c, 409, "no_master");
    if (rendered === "invalid_image") return fail(c, 400, "invalid_image");
    if (!(await setPhotoVersion(c.env, accountId, rendered.version, framing))) {
      return fail(c, 404, "not_found");
    }
    log("photo.framed", { accountId, size: rendered.size });
    return c.json({ photo: rendered.version }, 200);
  });

  app.openapi(getPhotoSourceRoute, async (c) => {
    const { accountId } = c.var.session;
    const row = await db(c.env)
      .prepare("SELECT 1 FROM accounts WHERE account_id = ? AND photo_version IS NOT NULL")
      .bind(accountId)
      .first();
    const object = row ? await getMaster(c.env, accountId) : null;
    return object ? c.body(object.body, 200, imageHeaders(object)) : fail(c, 404, "not_found");
  });

  app.openapi(deletePhotoRoute, async (c) => {
    const { accountId } = c.var.session;
    await removePhoto(c.env, accountId);
    log("photo.removed", { accountId });
    return c.body(null, 204);
  });

  app.openapi(getPhotoRoute, async (c) => {
    const owner = c.req.valid("param").accountId;
    const object = await photoFor(
      c.env,
      c.var.session.accountId,
      owner,
      c.req.valid("query").frame,
    );
    if (!object) return fail(c, 404, "not_found");
    return c.body(object.body, 200, imageHeaders(object));
  });
}
