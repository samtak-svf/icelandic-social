import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  createPostRoute,
  createReplyRoute,
  deletePostRoute,
  deleteReplyRoute,
  feedRoute,
  getPostRoute,
  listRepliesRoute,
  reactRoute,
  unreactRoute,
  wallRoute,
} from "./api/posts.ts";
import type { AppEnv } from "./app.ts";
import { db, withinLimit } from "./env/index.ts";
import { log } from "./log.ts";
import {
  createPost,
  createReply,
  decodeCursor,
  deletePost,
  deleteReply,
  post,
  posts,
  react,
  replies,
  unreact,
} from "./posts.ts";

// The routes of Fljótið and the walls (decision 0034). Log lines carry ids,
// never a body or a name (0008).

/** A cursor from the query: absent, one this server made, or "bad". */
function cursorOf(text: string | undefined) {
  if (text === undefined) return undefined;
  return decodeCursor(text) ?? "bad";
}

const accountExists = async (env: Env, accountId: string) =>
  (await db(env).prepare("SELECT 1 FROM accounts WHERE account_id = ?").bind(accountId).first()) !==
  null;

export function postRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(feedRoute, async (c) => {
    const { before, limit } = c.req.valid("query");
    const cursor = cursorOf(before);
    if (cursor === "bad") return c.json({ error: "invalid_request" }, 400);
    const found = await posts(c.env, c.var.device.accountId, { before: cursor, limit });
    return c.json({ posts: found.items, next: found.next }, 200);
  });

  app.openapi(wallRoute, async (c) => {
    const { accountId } = c.req.valid("param");
    const { before, limit } = c.req.valid("query");
    const cursor = cursorOf(before);
    if (cursor === "bad") return c.json({ error: "invalid_request" }, 400);
    if (!(await accountExists(c.env, accountId))) return c.json({ error: "not_found" }, 404);
    const found = await posts(c.env, c.var.device.accountId, {
      author: accountId,
      before: cursor,
      limit,
    });
    return c.json({ posts: found.items, next: found.next }, 200);
  });

  app.openapi(createPostRoute, async (c) => {
    const { accountId } = c.var.device;
    if (!(await withinLimit(c.env, "posts", accountId))) {
      log("request.rate_limited", { code: "posts" });
      return c.json({ error: "rate_limited" }, 429);
    }
    const created = await createPost(c.env, accountId, c.req.valid("json").body);
    log("post.created", { accountId, postId: created.postId });
    return c.json(created, 201);
  });

  app.openapi(getPostRoute, async (c) => {
    const found = await post(c.env, c.var.device.accountId, c.req.valid("param").postId);
    return found ? c.json(found, 200) : c.json({ error: "not_found" }, 404);
  });

  app.openapi(deletePostRoute, async (c) => {
    const { accountId } = c.var.device;
    const { postId } = c.req.valid("param");
    const deleted = await deletePost(c.env, accountId, postId);
    if (deleted !== "ok") return c.json({ error: deleted }, deleted === "not_found" ? 404 : 403);
    log("post.deleted", { accountId, postId });
    return c.body(null, 204);
  });

  app.openapi(reactRoute, async (c) => {
    const { postId } = c.req.valid("param");
    const done = await react(c.env, c.var.device.accountId, postId, c.req.valid("json").reaction);
    if (done !== "ok") return c.json({ error: done }, done === "not_found" ? 404 : 403);
    return c.body(null, 204);
  });

  app.openapi(unreactRoute, async (c) => {
    await unreact(c.env, c.var.device.accountId, c.req.valid("param").postId);
    return c.body(null, 204);
  });

  app.openapi(listRepliesRoute, async (c) => {
    const { after, limit } = c.req.valid("query");
    const cursor = cursorOf(after);
    if (cursor === "bad") return c.json({ error: "invalid_request" }, 400);
    const found = await replies(c.env, c.var.device.accountId, c.req.valid("param").postId, {
      after: cursor,
      limit,
    });
    if (!found) return c.json({ error: "not_found" }, 404);
    return c.json({ replies: found.items, next: found.next }, 200);
  });

  app.openapi(createReplyRoute, async (c) => {
    const { accountId } = c.var.device;
    if (!(await withinLimit(c.env, "posts", accountId))) {
      log("request.rate_limited", { code: "posts" });
      return c.json({ error: "rate_limited" }, 429);
    }
    const { postId } = c.req.valid("param");
    const created = await createReply(c.env, accountId, postId, c.req.valid("json").body);
    if (created === "not_found") return c.json({ error: created }, 404);
    if (created === "blocked") return c.json({ error: created }, 403);
    log("post.replied", { accountId, postId });
    return c.json(created, 201);
  });

  app.openapi(deleteReplyRoute, async (c) => {
    const { accountId } = c.var.device;
    const deleted = await deleteReply(c.env, accountId, c.req.valid("param").replyId);
    if (deleted !== "ok") return c.json({ error: deleted }, deleted === "not_found" ? 404 : 403);
    log("post.reply_deleted", { accountId });
    return c.body(null, 204);
  });
}
