import type { OpenAPIHono } from "@hono/zod-openapi";
import { framingFits } from "../../api/image-frames.ts";
import {
  deleteWallCoverRoute,
  getWallCoverRoute,
  getWallCoverSourceRoute,
  patchWallCoverFramesRoute,
  putWallCoverRoute,
} from "../../api/walls.ts";
import { db, withinLimit } from "../../env/index.ts";
import type { AppEnv } from "../../http.ts";
import { blockedEither, notSuspended } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import {
  communityCoverKey,
  deleteImage,
  getFrame,
  getMaster,
  imageHeaders,
  renderFrames,
} from "../../shared/images.ts";
import { log } from "../../shared/log.ts";
import { imageVersion } from "./communities.ts";
import { uploadedImage } from "./images.ts";
import { ensureWall, wallOf } from "./walls.ts";

// A wall's cover (decisions 0086, 0115): a community cover's path and key, with
// the wall as the only difference. Its owner changes it, with no log entry, as
// their own profile photo; every signed-in account reads it, a block excepted.

/** Takes the cover off `accountId`'s wall, with `entries` in the same write. */
export async function clearWallCover(
  env: Env,
  accountId: string,
  entries: D1PreparedStatement[] = [],
): Promise<void> {
  const wall = await wallOf(env, accountId);
  if (!wall) {
    if (entries.length > 0) await db(env).batch(entries);
    return;
  }
  // The version first, so none names a missing image.
  await db(env).batch([imageVersion(env, wall.communityId, "cover", null, null), ...entries]);
  await deleteImage(env, communityCoverKey(wall.communityId), "cover");
}

export function wallImageRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(notSuspended(putWallCoverRoute), async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = await ensureWall(c.env, accountId);
    const key = communityCoverKey(communityId);
    const stored = await uploadedImage(c, accountId, key, "cover");
    if ("error" in stored) return fail(c, stored.status, stored.error);
    await imageVersion(c.env, communityId, "cover", stored.version, stored.framing).run();
    log("wall.cover_set", { accountId, communityId, size: stored.size });
    return c.json({ version: stored.version }, 200);
  });

  app.openapi(deleteWallCoverRoute, async (c) => {
    await clearWallCover(c.env, c.var.session.accountId);
    return c.body(null, 204);
  });

  app.openapi(notSuspended(patchWallCoverFramesRoute), async (c) => {
    const { accountId } = c.var.session;
    const framing = c.req.valid("json");
    const wall = await wallOf(c.env, accountId);
    if (!wall || wall.cover === null) return fail(c, 404, "not_found");
    if (!framingFits("cover", framing)) return fail(c, 400, "invalid_request");
    if (!(await withinLimit(c.env, "photos", accountId))) {
      log("request.rate_limited", { code: "photos", requestId: c.var.requestId });
      return fail(c, 429, "rate_limited");
    }
    const key = communityCoverKey(wall.communityId);
    const rendered = await renderFrames(c.env, key, "cover", framing);
    if (rendered === "no_master") return fail(c, 409, "no_master");
    if (rendered === "invalid_image") return fail(c, 400, "invalid_image");
    await imageVersion(c.env, wall.communityId, "cover", rendered.version, framing).run();
    return c.json({ version: rendered.version }, 200);
  });

  app.openapi(getWallCoverSourceRoute, async (c) => {
    const wall = await wallOf(c.env, c.var.session.accountId);
    const object =
      wall && wall.cover !== null
        ? await getMaster(c.env, communityCoverKey(wall.communityId))
        : null;
    return object ? c.body(object.body, 200, imageHeaders(object)) : fail(c, 404, "not_found");
  });

  app.openapi(getWallCoverRoute, async (c) => {
    const { accountId } = c.req.valid("param");
    if ((await blockedEither(c.env, c.var.session.accountId)).includes(accountId)) {
      return fail(c, 404, "not_found");
    }
    const wall = await wallOf(c.env, accountId);
    if (!wall || wall.cover === null) return fail(c, 404, "not_found");
    const key = communityCoverKey(wall.communityId);
    const object = await getFrame(c.env, key, "cover", c.req.valid("query").frame);
    return object ? c.body(object.body, 200, imageHeaders(object)) : fail(c, 404, "not_found");
  });
}
