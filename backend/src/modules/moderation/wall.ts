import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  removeWallCommentRoute,
  reportedMediaRoute,
  reportedTargetRoute,
} from "../../api/walls.ts";
import { db } from "../../env/index.ts";
import type { AppEnv } from "../../http.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { wallAt } from "../communities/index.ts";
import { notice } from "../jobs/index.ts";
import {
  commentAccess,
  commentMedia,
  keptText,
  moderateComment,
  postMedia,
  readImage,
} from "../social/index.ts";
import { entry } from "./log.ts";
import { isPlatformModerator, openReport } from "./reports.ts";

// What moderation is on a wall (decision 0115): its owner removes a comment on
// it, logged and told, and a platform moderator reads a post or comment on it
// only through an open report, each read logged before it is answered.

/** The open report on a wall post or comment `reportId` names, or null. */
async function reportedOnWall(env: Env, reportId: string) {
  const report = await openReport(env, reportId);
  if (!report?.toPlatform || !report.communityId) return null;
  const { communityId, targetId, targetKind, targetAccount } = report;
  if (targetKind !== "post" && targetKind !== "comment") return null;
  if ((await wallAt(env, communityId)) === null) return null;
  return { communityId, targetId, targetKind, targetAccount };
}

/** The ids of the images of the reported post or comment. */
async function mediaOf(
  env: Env,
  target: { targetKind: "post" | "comment"; targetId: string },
): Promise<string[]> {
  if (target.targetKind === "post") return postMedia(env, target.targetId);
  const found = await commentMedia(env, [target.targetId]);
  return (found.get(target.targetId) ?? []).map((m) => m.mediaId);
}

export function wallModerationRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(removeWallCommentRoute, async (c) => {
    const { accountId } = c.var.session;
    const { commentId } = c.req.valid("param");
    const found = await commentAccess(c.env, accountId, commentId);
    if (found?.access.wall?.ownerId !== accountId || !found) return fail(c, 404, "not_found");
    const { communityId, postId } = found.post;
    const author = found.comment.author;
    // A person's own comment is deleted, not moderated.
    if (author === accountId) return fail(c, 400, "invalid_request");
    await moderateComment(c.env, communityId, commentId, "removed", [
      entry(c.env, {
        communityId,
        actorId: accountId,
        asPlatform: false,
        action: "remove_comment",
        targetKind: "comment",
        targetId: commentId,
        targetAccount: author,
        reason: c.req.valid("json").reason,
      }),
      notice(c.env, `${commentId}:remove_comment:${Date.now()}`, {
        kind: "moderated",
        accountId: author,
        actorId: accountId,
        communityId,
        postId,
        commentId,
        action: "remove_comment",
      }),
    ]);
    log("wall.comment_removed", { accountId, communityId, postId });
    return c.body(null, 204);
  });

  /** The statement that records this read, for the batch before the answer. */
  const read = (
    env: Env,
    accountId: string,
    reportId: string,
    target: NonNullable<Awaited<ReturnType<typeof reportedOnWall>>>,
  ) =>
    db(env).batch([
      entry(env, {
        communityId: target.communityId,
        actorId: accountId,
        asPlatform: true,
        action: "read_reported",
        targetKind: target.targetKind,
        targetId: target.targetId,
        targetAccount: target.targetAccount,
        reason: reportId,
      }),
    ]);

  app.openapi(reportedTargetRoute, async (c) => {
    const { accountId } = c.var.session;
    if (!(await isPlatformModerator(c.env, accountId))) return fail(c, 403, "not_permitted");
    const { reportId } = c.req.valid("param");
    const target = await reportedOnWall(c.env, reportId);
    if (!target) return fail(c, 404, "not_found");
    await read(c.env, accountId, reportId, target);
    const body = await keptText(c.env, target.communityId, target.targetKind, target.targetId);
    return c.json({ body, media: await mediaOf(c.env, target) }, 200);
  });

  app.openapi(reportedMediaRoute, async (c) => {
    const { accountId } = c.var.session;
    if (!(await isPlatformModerator(c.env, accountId))) return fail(c, 403, "not_permitted");
    const { reportId, mediaId } = c.req.valid("param");
    const target = await reportedOnWall(c.env, reportId);
    if (!target || !(await mediaOf(c.env, target)).includes(mediaId)) {
      return fail(c, 404, "not_found");
    }
    await read(c.env, accountId, reportId, target);
    const image = await readImage(c.env, target.communityId, mediaId);
    if (!image) return fail(c, 404, "not_found");
    return c.body(image.body, 200, {
      "content-type": "image/webp",
      "cache-control": "private, no-store",
    });
  });
}
