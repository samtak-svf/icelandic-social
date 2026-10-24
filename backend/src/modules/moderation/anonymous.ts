import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  anonymousQueueRoute,
  approveAnonymousRoute,
  declineAnonymousRoute,
  revealAuthorRoute,
} from "../../api/anonymous.ts";
import type { AppEnv } from "../../app.ts";
import { db } from "../../env/index.ts";
import { fail } from "../../errors.ts";
import { log } from "../../log.ts";
import { moderates, type Standing } from "../communities/index.ts";
import { notice } from "../jobs/index.ts";
import {
  authors,
  deletePending,
  pendingAnonymous,
  pendingQueue,
  postAccess,
  publishPending,
} from "../social/index.ts";
import { actor } from "./actions.ts";
import { entry } from "./log.ts";

// Anonymous posts and the people who answer for them (decision 0091): a
// moderator publishes or declines a post waiting for approval, and may reveal
// an author, which the log records by who revealed, never whom. Approving
// reveals nothing, and no answer here but the reveal carries an author.

export function anonymousRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(anonymousQueueRoute, async (c) => {
    const { communityId } = c.req.valid("param");
    const { before, limit } = c.req.valid("query");
    const accountId = c.var.session.accountId;
    const me = await actor(c.env, accountId, communityId);
    if (me === "not_found") return fail(c, 404, "not_found");
    if (me === "not_permitted") return fail(c, 403, "not_permitted");
    const page = await pendingQueue(c.env, accountId, communityId, before, limit);
    return page ? c.json(page, 200) : fail(c, 404, "not_found");
  });

  /** The pending anonymous post `postId` and the caller's standing, or the refusal. */
  async function pendingFor(env: Env, accountId: string, postId: string) {
    const post = await pendingAnonymous(env, postId);
    if (!post) return "not_found" as const;
    const me = await actor(env, accountId, post.communityId);
    return typeof me === "string" ? me : { post, me };
  }

  app.openapi(approveAnonymousRoute, async (c) => {
    const { accountId } = c.var.session;
    const found = await pendingFor(c.env, accountId, c.req.valid("param").postId);
    if (found === "not_found") return fail(c, 404, "not_found");
    if (found === "not_permitted") return fail(c, 403, "not_permitted");
    if (!(await publishPending(c.env, found.post))) return fail(c, 404, "not_found");
    log("post.approved", { accountId, communityId: found.post.communityId });
    return c.body(null, 204);
  });

  app.openapi(declineAnonymousRoute, async (c) => {
    const { accountId } = c.var.session;
    const found = await pendingFor(c.env, accountId, c.req.valid("param").postId);
    if (found === "not_found") return fail(c, 404, "not_found");
    if (found === "not_permitted") return fail(c, 403, "not_permitted");
    const { post } = found;
    // The notice first, as for any action; it names the author only to the author,
    // and no post, because the post is gone.
    await db(c.env).batch([
      notice(c.env, `${post.postId}:decline`, {
        kind: "moderated",
        accountId: post.authorId,
        actorId: accountId,
        communityId: post.communityId,
        action: "decline_anonymous_post",
      }),
    ]);
    if (!(await deletePending(c.env, post))) return fail(c, 404, "not_found");
    log("post.declined", { accountId, communityId: post.communityId });
    return c.body(null, 204);
  });

  app.openapi(revealAuthorRoute, async (c) => {
    const { accountId } = c.var.session;
    const found = await postAccess(c.env, accountId, c.req.valid("param").postId);
    // Reading a post is the first condition, so a reveal tells a stranger nothing.
    if (!found || found.post.anonymous !== 1) return fail(c, 404, "not_found");
    const me: Standing = found.access.standing;
    if (!moderates(me) && !me.platformModerator) return fail(c, 403, "not_permitted");
    const { postId, communityId, authorId } = found.post;
    const author = (await authors(c.env, [authorId], communityId)).get(authorId);
    if (!author) return fail(c, 404, "not_found");
    // Logged before it is answered: no reveal goes unrecorded.
    await db(c.env).batch([
      entry(c.env, {
        communityId,
        actorId: accountId,
        asPlatform: !moderates(me),
        action: "reveal_author",
        targetKind: "post",
        targetId: postId,
        targetAccount: null,
        reason: "",
      }),
    ]);
    log("post.author_revealed", { accountId, communityId, postId });
    return c.json(author, 200);
  });
}
