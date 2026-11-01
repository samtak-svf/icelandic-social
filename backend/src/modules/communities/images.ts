import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  deleteCommunityAvatarRoute,
  deleteCommunityCoverRoute,
  getCommunityAvatarRoute,
  getCommunityAvatarSourceRoute,
  getCommunityCoverRoute,
  getCommunityCoverSourceRoute,
  patchCommunityAvatarFramesRoute,
  patchCommunityCoverFramesRoute,
  putCommunityAvatarRoute,
  putCommunityCoverRoute,
} from "../../api/community-images.ts";
import { MAX_PHOTO_UPLOAD } from "../../api/accounts.ts";
import type { AppEnv } from "../../http.ts";
import type { Context } from "hono";
import { framingFits } from "../../api/image-frames.ts";
import { db } from "../../env/index.ts";
import { fail, cancelBody } from "../../shared/errors.ts";
import {
  communityCoverKey,
  communityPictureKey,
  deleteImage,
  getFrame,
  getMaster,
  imageHeaders,
  renderFrames,
  storeImage,
  takeUpload,
} from "../../shared/images.ts";
import { log } from "../../shared/log.ts";
import { overLimit, rateLimited } from "../../shared/rate-limit.ts";
import { canRead, moderates } from "./access.ts";
import { imageVersion, standing } from "./communities.ts";
import type { LifecycleHooks } from "./lifecycle.ts";

// A community's picture and cover (decision 0080): the account photo's path
// (src/shared/images.ts) with another size and R2 key, written by the community's
// owner and moderators, and read by whoever the community's read rule admits,
// so a private community's images are as private as its posts. Each change is
// one batch with its moderation log entry (0066). A log line carries the
// ids and a size, never a name or the image (0008).

const KINDS = {
  photo: { frames: "photo", key: communityPictureKey },
  cover: { frames: "cover", key: communityCoverKey },
} as const;

type Kind = keyof typeof KINDS;

/**
 * The request's body stored as the image at `key`, or why not: a community's
 * picture and cover and a wall's cover share it.
 */
export async function uploadedImage(
  c: Context<AppEnv>,
  accountId: string,
  key: string,
  frames: "photo" | "cover",
) {
  const upload = await takeUpload(c, accountId, MAX_PHOTO_UPLOAD);
  if ("error" in upload) return upload;
  let stored: Awaited<ReturnType<typeof storeImage>>;
  try {
    stored = await storeImage(c.env, key, frames, upload.body, upload.length);
  } catch {
    // The body ended short of, or ran past, its Content-Length.
    return { status: 400 as const, error: "invalid_request" as const };
  }
  return stored === "invalid_image"
    ? { status: 400 as const, error: "invalid_image" as const }
    : stored;
}

export function communityImageRoutes(app: OpenAPIHono<AppEnv>, hooks: LifecycleHooks): void {
  const set = (route: typeof putCommunityAvatarRoute, kind: Kind) =>
    app.openapi(route, async (c) => {
      const { accountId } = c.var.session;
      const { communityId } = c.req.valid("param");
      const found = await standing(c.env, accountId, communityId);
      // A refusal cancels the body, so a client that is uploading stops sending it.
      if (!found) return cancelBody(c, fail(c, 404, "not_found"));
      if (!moderates(found)) return cancelBody(c, fail(c, 403, "not_permitted"));
      const { frames, key } = KINDS[kind];
      const stored = await uploadedImage(c, accountId, key(communityId), frames);
      if ("error" in stored) return fail(c, stored.status, stored.error);
      // The object first, then the version, so none names an image not there yet.
      const [written] = await db(c.env).batch([
        imageVersion(c.env, communityId, kind, stored.version, stored.framing),
        hooks.recordImage(c.env, communityId, accountId, kind, "set"),
      ]);
      // The community was deleted while the image was on its way: keep nothing.
      if (!written || written.meta.changes === 0) {
        await deleteImage(c.env, key(communityId), frames);
        return fail(c, 404, "not_found");
      }
      log(`community.${kind}_set`, { accountId, communityId, size: stored.size });
      return c.json({ version: stored.version }, 200);
    });

  const remove = (route: typeof deleteCommunityAvatarRoute, kind: Kind) =>
    app.openapi(route, async (c) => {
      const { accountId } = c.var.session;
      const { communityId } = c.req.valid("param");
      const found = await standing(c.env, accountId, communityId);
      if (!found) return fail(c, 404, "not_found");
      if (!moderates(found)) return fail(c, 403, "not_permitted");
      // The version first, so none names a missing image; nothing to log if there was none.
      if (found[kind] !== null) {
        await db(c.env).batch([
          imageVersion(c.env, communityId, kind, null, null),
          hooks.recordImage(c.env, communityId, accountId, kind, "remove"),
        ]);
        log(`community.${kind}_removed`, { accountId, communityId });
      }
      await deleteImage(c.env, KINDS[kind].key(communityId), KINDS[kind].frames);
      return c.body(null, 204);
    });

  const read = (route: typeof getCommunityAvatarRoute, kind: Kind) =>
    app.openapi(route, async (c) => {
      const { communityId } = c.req.valid("param");
      const found = await standing(c.env, c.var.session.accountId, communityId);
      // The community's read rule, as for a post: otherwise the answer is the same 404.
      if (!found || found[kind] === null || !(canRead(found) || found.platformModerator)) {
        return fail(c, 404, "not_found");
      }
      const { frames, key } = KINDS[kind];
      const object = await getFrame(c.env, key(communityId), frames, c.req.valid("query").frame);
      return object ? c.body(object.body, 200, imageHeaders(object)) : fail(c, 404, "not_found");
    });

  const frame = (route: typeof patchCommunityAvatarFramesRoute, kind: Kind) =>
    app.openapi(route, async (c) => {
      const { accountId } = c.var.session;
      const { communityId } = c.req.valid("param");
      const framing = c.req.valid("json");
      const found = await standing(c.env, accountId, communityId);
      if (!found) return fail(c, 404, "not_found");
      if (!moderates(found)) return fail(c, 403, "not_permitted");
      const { frames, key } = KINDS[kind];
      if (found[kind] === null) return fail(c, 404, "not_found");
      if (!framingFits(frames, framing)) return fail(c, 400, "invalid_request");
      if (await overLimit(c, "photos", accountId)) return rateLimited(c);
      const rendered = await renderFrames(c.env, key(communityId), frames, framing);
      if (rendered === "no_master") return fail(c, 409, "no_master");
      if (rendered === "invalid_image") return fail(c, 400, "invalid_image");
      // A re-framing is a change of the image, logged as a set.
      const [written] = await db(c.env).batch([
        imageVersion(c.env, communityId, kind, rendered.version, framing),
        hooks.recordImage(c.env, communityId, accountId, kind, "set"),
      ]);
      if (!written || written.meta.changes === 0) return fail(c, 404, "not_found");
      log(`community.${kind}_framed`, { accountId, communityId, size: rendered.size });
      return c.json({ version: rendered.version }, 200);
    });

  const source = (route: typeof getCommunityAvatarSourceRoute, kind: Kind) =>
    app.openapi(route, async (c) => {
      const { communityId } = c.req.valid("param");
      const found = await standing(c.env, c.var.session.accountId, communityId);
      // Who may change the image may read its master; everyone else gets the same 404 as for none.
      if (!found || found[kind] === null || !moderates(found)) return fail(c, 404, "not_found");
      const object = await getMaster(c.env, KINDS[kind].key(communityId));
      return object ? c.body(object.body, 200, imageHeaders(object)) : fail(c, 404, "not_found");
    });

  set(putCommunityAvatarRoute, "photo");
  set(putCommunityCoverRoute, "cover");
  remove(deleteCommunityAvatarRoute, "photo");
  remove(deleteCommunityCoverRoute, "cover");
  read(getCommunityAvatarRoute, "photo");
  read(getCommunityCoverRoute, "cover");
  frame(patchCommunityAvatarFramesRoute, "photo");
  frame(patchCommunityCoverFramesRoute, "cover");
  source(getCommunityAvatarSourceRoute, "photo");
  source(getCommunityCoverSourceRoute, "cover");
}
