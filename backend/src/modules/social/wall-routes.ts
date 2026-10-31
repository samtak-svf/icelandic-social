import type { OpenAPIHono } from "@hono/zod-openapi";
import { MAX_BIO } from "../../api/social.ts";
import {
  createWallPostRoute,
  getWallRoute,
  setBioRoute,
  setPostAudienceRoute,
  uploadWallMediaRoute,
  wallImagesRoute,
  wallPostsRoute,
} from "../../api/walls.ts";
import { db } from "../../env/index.ts";
import type { AppEnv } from "../../http.ts";
import {
  accountProfile,
  blockedEither,
  notSuspended,
  setBio,
  suspendedRefusal,
} from "../../identity/index.ts";
import { CLIENT_HEADER, decodesEveryNotice } from "../../shared/client-version.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { ensureWall, wallOf } from "../communities/index.ts";
import { spaceAccess, seesEveryPost, type SpaceAccess } from "./access.ts";
import { authors } from "./bylines.ts";
import { communityImages } from "./media.ts";
import { communityPosts } from "./post-page.ts";
import { createPost } from "./posts.ts";
import { renderListed } from "./tombstones.ts";
import { storedUpload } from "./upload.ts";

// A person's wall (decision 0115): its reads ask access.ts, as a community's do,
// and its writes are the owner's. A log line carries ids, never a text (0008).

const LINE_BREAK = /[\n\r\u2028\u2029]/;

/** What is wrong with a post's fields, as in a community (decisions 0082, 0090). */
export function invalidPost(input: {
  body: string;
  media: string[];
  poll?: { options: string[] } | undefined;
}): boolean {
  if (input.body === "" && input.media.length === 0) return true;
  if (!input.poll) return false;
  const texts = input.poll.options;
  const distinct = new Set(texts.map((t) => t.toLowerCase())).size === texts.length;
  return input.body === "" || input.media.length > 0 || !distinct;
}

/** The wall of `accountId` as `viewer` reads it: the access, or none when it has no wall. */
async function reading(
  env: Env,
  viewer: string,
  accountId: string,
): Promise<{ communityId: string; access: Extract<SpaceAccess, { wall: object }> } | null> {
  const wall = await wallOf(env, accountId);
  const access = wall && (await spaceAccess(env, viewer, wall.communityId));
  return wall && access?.wall ? { communityId: wall.communityId, access } : null;
}

export function wallRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getWallRoute, async (c) => {
    const { accountId } = c.req.valid("param");
    const blocked = await blockedEither(c.env, c.var.session.accountId);
    const profile = blocked.includes(accountId) ? null : await accountProfile(c.env, accountId);
    if (!profile) return fail(c, 404, "not_found");
    const wall = await wallOf(c.env, accountId);
    return c.json(
      {
        accountId,
        wallId: wall?.communityId ?? null,
        bio: profile.bio,
        cover: wall?.cover ?? null,
        coverFrames: wall?.coverFrames ?? null,
        joinedMonth: new Date(profile.createdAt).toISOString().slice(0, 7),
      },
      200,
    );
  });

  app.openapi(wallPostsRoute, async (c) => {
    const viewer = c.var.session.accountId;
    const { accountId } = c.req.valid("param");
    const { before, limit } = c.req.valid("query");
    if ((await blockedEither(c.env, viewer)).includes(accountId)) return fail(c, 404, "not_found");
    const wall = await reading(c.env, viewer, accountId);
    if (!wall) return c.json({ posts: [], next: null }, 200);
    const knowing = decodesEveryNotice(c.env, c.req.header(CLIENT_HEADER));
    const page = await communityPosts(
      c.env,
      wall.communityId,
      wall.access.viewer,
      before,
      limit,
      knowing,
      undefined,
      !seesEveryPost(wall.access.wall, viewer),
    );
    return c.json(
      { posts: await renderListed(c.env, page.rows, wall.access.viewer), next: page.next },
      200,
    );
  });

  app.openapi(wallImagesRoute, async (c) => {
    const viewer = c.var.session.accountId;
    const { accountId } = c.req.valid("param");
    const { cursor, limit } = c.req.valid("query");
    if ((await blockedEither(c.env, viewer)).includes(accountId)) return fail(c, 404, "not_found");
    const wall = await reading(c.env, viewer, accountId);
    if (!wall) return c.json({ images: [], next: null }, 200);
    const page = await communityImages(
      c.env,
      wall.communityId,
      wall.access.viewer.hidden,
      cursor,
      limit,
      !seesEveryPost(wall.access.wall, viewer),
    );
    return c.json({ images: page.rows, next: page.next }, 200);
  });

  app.openapi(notSuspended(createWallPostRoute), async (c) => {
    const { accountId } = c.var.session;
    const input = c.req.valid("json");
    if (invalidPost(input)) return fail(c, 400, "invalid_request");
    const { communityId } = await ensureWall(c.env, accountId);
    const created = await createPost(c.env, communityId, accountId, {
      body: input.body,
      media: input.media,
      poll: input.poll?.options,
      audience: input.audience,
    });
    if (created === "invalid_media") return fail(c, 400, "invalid_media");
    const author = (await authors(c.env, [accountId], communityId)).get(accountId);
    if (!author) return fail(c, 400, "invalid_request");
    log("post.created", { accountId, communityId, postId: created.postId });
    return c.json(
      {
        ...created,
        communityId,
        author,
        anonymous: false,
        mine: true,
        state: "visible" as const,
        pinned: false,
        wall: { accountId },
        audience: input.audience,
      },
      200,
    );
  });

  app.openapi(notSuspended(uploadWallMediaRoute), async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = await ensureWall(c.env, accountId);
    const stored = await storedUpload(c, communityId, accountId);
    return "error" in stored ? fail(c, stored.status, stored.error) : c.json(stored, 200);
  });

  // The audience lives in D1 alone: the space never decides who reads.
  app.openapi(notSuspended(setPostAudienceRoute), async (c) => {
    const { meta } = await db(c.env)
      .prepare(
        `UPDATE post_index SET audience = ?1
          WHERE post_id = ?2 AND author_id = ?3 AND audience IS NOT NULL`,
      )
      .bind(c.req.valid("json").audience, c.req.valid("param").postId, c.var.session.accountId)
      .run();
    return meta.changes > 0 ? c.body(null, 204) : fail(c, 404, "not_found");
  });

  // Clearing is taking back, like a cover's removal, so a suspension refuses only new text.
  app.openapi(setBioRoute, async (c) => {
    const bio = c.req.valid("json").bio.trim();
    const refused = bio === "" ? null : await suspendedRefusal(c);
    if (refused) return refused;
    if (LINE_BREAK.test(bio) || Array.from(bio).length > MAX_BIO) {
      return fail(c, 400, "invalid_request");
    }
    await setBio(c.env, c.var.session.accountId, bio === "" ? null : bio);
    return c.body(null, 204);
  });
}
