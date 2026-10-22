import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  deleteCommunityAvatarRoute,
  deleteCommunityCoverRoute,
  getCommunityAvatarRoute,
  getCommunityCoverRoute,
  putCommunityAvatarRoute,
  putCommunityCoverRoute,
} from "../../api/communities.ts";
import { MAX_PHOTO_UPLOAD } from "../../api/accounts.ts";
import type { AppEnv } from "../../app.ts";
import { db, profilesBucket } from "../../env/index.ts";
import { fail } from "../../errors.ts";
import {
  communityCoverKey,
  communityPictureKey,
  COVER,
  deleteImage,
  imageHeaders,
  SQUARE,
  storeImage,
  takeUpload,
} from "../../images.ts";
import { log } from "../../log.ts";
import { canRead, moderates } from "./access.ts";
import { imageVersion, standing } from "./communities.ts";
import type { LifecycleHooks } from "./lifecycle.ts";

// A community's picture and cover (decision 0080): the account photo's path
// (src/images.ts) with another size and R2 key, written by the community's
// owner and moderators, and read by whoever the community's read rule admits,
// so a private community's images are as private as its posts. Each change is
// one batch with its moderation log entry (0066). A log line carries the
// ids and a size, never a name or the image (0008).

const KINDS = {
  photo: { shape: SQUARE, key: communityPictureKey },
  cover: { shape: COVER, key: communityCoverKey },
} as const;

type Kind = keyof typeof KINDS;

export function communityImageRoutes(app: OpenAPIHono<AppEnv>, hooks: LifecycleHooks): void {
  const set = (route: typeof putCommunityAvatarRoute, kind: Kind) =>
    app.openapi(route, async (c) => {
      const { accountId } = c.var.session;
      const { communityId } = c.req.valid("param");
      const found = await standing(c.env, accountId, communityId);
      if (!found) return fail(c, 404, "not_found");
      if (!moderates(found)) return fail(c, 403, "not_permitted");
      const upload = await takeUpload(c, accountId, MAX_PHOTO_UPLOAD);
      if ("error" in upload) return fail(c, upload.status, upload.error);
      const { shape, key } = KINDS[kind];
      let stored: Awaited<ReturnType<typeof storeImage>>;
      try {
        stored = await storeImage(c.env, key(communityId), shape, upload.body, upload.length);
      } catch {
        // The body ended short of, or ran past, its Content-Length.
        return fail(c, 400, "invalid_request");
      }
      if (stored === "invalid_image") return fail(c, 400, "invalid_image");
      // The object first, then the version, so none names an image not there yet.
      const [written] = await db(c.env).batch([
        imageVersion(c.env, communityId, kind, stored.version),
        hooks.recordImage(c.env, communityId, accountId, kind, "set"),
      ]);
      // The community was deleted while the image was on its way: keep nothing.
      if (!written || written.meta.changes === 0) {
        await deleteImage(c.env, key(communityId));
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
          imageVersion(c.env, communityId, kind, null),
          hooks.recordImage(c.env, communityId, accountId, kind, "remove"),
        ]);
        log(`community.${kind}_removed`, { accountId, communityId });
      }
      await deleteImage(c.env, KINDS[kind].key(communityId));
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
      const object = await profilesBucket(c.env).get(KINDS[kind].key(communityId));
      return object ? c.body(object.body, 200, imageHeaders(object)) : fail(c, 404, "not_found");
    });

  set(putCommunityAvatarRoute, "photo");
  set(putCommunityCoverRoute, "cover");
  remove(deleteCommunityAvatarRoute, "photo");
  remove(deleteCommunityCoverRoute, "cover");
  read(getCommunityAvatarRoute, "photo");
  read(getCommunityCoverRoute, "cover");
}
