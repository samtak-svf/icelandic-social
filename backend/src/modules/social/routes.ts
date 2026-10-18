import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  communityPostsRoute,
  createCommentRoute,
  createPostRoute,
  deleteCommentRoute,
  deletePostRoute,
  feedRoute,
  getPostMediaRoute,
  getPostRoute,
  listCommentsRoute,
  MAX_SOCIAL_UPLOAD,
  reactRoute,
  unreactRoute,
  uploadSocialMediaRoute,
} from "../../api/social.ts";
import type { AppEnv } from "../../app.ts";
import { space, withinLimit } from "../../env/index.ts";
import { blockedEither } from "../../identity/index.ts";
import { fail } from "../../errors.ts";
import { log } from "../../log.ts";
import { canTakePart, postAccess, spaceAccess, type SpaceAccess } from "./access.ts";
import type { CommentContent } from "./do/space.ts";
import { deleteKeys, postImage, upload } from "./media.ts";
import {
  authors,
  communityPosts,
  createPost,
  feed,
  newCommentId,
  noteAuthor,
  parseCursor,
  render,
  unindex,
} from "./posts.ts";

// The routes of a community's content (decisions 0060, 0063). Each asks
// access.ts whether the caller may see what it names before anything else.
// A log line carries ids and counts, never a text or an image (0008).

/** Why a member may not add to a space, as the error the routes answer. */
const refusal = (access: SpaceAccess) => (access.standing.role ? "read_only" : "not_a_member");

/** Comments with their authors' names; a deleted author's go. */
async function named(env: Env, comments: CommentContent[]) {
  const names = await authors(
    env,
    comments.map((c) => c.author),
  );
  return comments.flatMap((c) => {
    const author = names.get(c.author);
    return author ? [{ ...c, author }] : [];
  });
}

export function socialRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(createPostRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const access = await spaceAccess(c.env, accountId, communityId);
    if (!access) return fail(c, 404, "not_found");
    if (!canTakePart(access)) return fail(c, 403, refusal(access));
    const input = c.req.valid("json");
    if (input.body === "" && input.media.length === 0) return fail(c, 400, "invalid_request");
    const created = await createPost(c.env, communityId, accountId, input);
    if (created === "invalid_media") return fail(c, 400, "invalid_media");
    const author = (await authors(c.env, [accountId])).get(accountId);
    if (!author) return fail(c, 404, "not_found");
    log("post.created", { accountId, communityId, postId: created.postId });
    return c.json({ ...created, communityId, author }, 200);
  });

  app.openapi(uploadSocialMediaRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const body = c.req.raw.body;
    // A refusal cancels the body, so the client stops sending it.
    const refuse = async <T>(answer: T) => (await body?.cancel(), answer);
    const access = await spaceAccess(c.env, accountId, communityId);
    if (!access) return refuse(fail(c, 404, "not_found"));
    if (!canTakePart(access)) return refuse(fail(c, 403, refusal(access)));
    if (!(await withinLimit(c.env, "photos", `social:${accountId}`))) {
      log("request.rate_limited", { code: "photos", requestId: c.var.requestId });
      return refuse(fail(c, 429, "rate_limited"));
    }
    const length = Number(c.req.header("content-length") ?? Number.NaN);
    if (!Number.isSafeInteger(length) || length < 1 || !body) {
      return refuse(fail(c, 400, "invalid_request"));
    }
    if (length > MAX_SOCIAL_UPLOAD) return refuse(fail(c, 413, "too_large"));
    let stored: Awaited<ReturnType<typeof upload>>;
    try {
      stored = await upload(c.env, communityId, accountId, body, length);
    } catch {
      // The body ended short of, or ran past, its Content-Length.
      return fail(c, 400, "invalid_request");
    }
    if (stored === "invalid_image") return fail(c, 400, "invalid_image");
    log("social_media.stored", { accountId, communityId, size: length });
    return c.json(stored, 200);
  });

  app.openapi(communityPostsRoute, async (c) => {
    const { communityId } = c.req.valid("param");
    const { before, limit } = c.req.valid("query");
    const access = await spaceAccess(c.env, c.var.session.accountId, communityId);
    if (!access) return fail(c, 404, "not_found");
    const page = await communityPosts(c.env, communityId, access.viewer, before, limit);
    return c.json({ posts: await render(c.env, page.rows, access.viewer), next: page.next }, 200);
  });

  app.openapi(feedRoute, async (c) => {
    const { accountId } = c.var.session;
    const { before, limit } = c.req.valid("query");
    const page = await feed(c.env, accountId, before, limit);
    // The feed's SQL left out the posts of the blocked; the spaces hide their comments and reactions.
    const viewer = { account: accountId, hidden: await blockedEither(c.env, accountId) };
    return c.json({ posts: await render(c.env, page.rows, viewer), next: page.next }, 200);
  });

  app.openapi(getPostRoute, async (c) => {
    const found = await postAccess(c.env, c.var.session.accountId, c.req.valid("param").postId);
    if (!found) return fail(c, 404, "not_found");
    const [post] = await render(c.env, [found.post], found.access.viewer);
    return post ? c.json(post, 200) : fail(c, 404, "not_found");
  });

  app.openapi(deletePostRoute, async (c) => {
    const { accountId } = c.var.session;
    const found = await postAccess(c.env, accountId, c.req.valid("param").postId);
    if (!found) return fail(c, 404, "not_found");
    const { postId, communityId, authorId } = found.post;
    if (authorId !== accountId) return fail(c, 403, "not_author");
    await space(c.env, communityId).deletePost(postId);
    await deleteKeys(c.env, await unindex(c.env, communityId, [postId]));
    log("post.deleted", { accountId, communityId, postId });
    return c.body(null, 204);
  });

  app.openapi(getPostMediaRoute, async (c) => {
    const { postId, mediaId } = c.req.valid("param");
    const found = await postAccess(c.env, c.var.session.accountId, postId);
    const image = found && (await postImage(c.env, found.post.communityId, postId, mediaId));
    if (!image) return fail(c, 404, "not_found");
    return c.body(image.body, 200, {
      "content-type": "image/webp",
      "cache-control": "private, max-age=3600",
    });
  });

  app.openapi(listCommentsRoute, async (c) => {
    const { postId } = c.req.valid("param");
    const { after, limit } = c.req.valid("query");
    const found = await postAccess(c.env, c.var.session.accountId, postId);
    if (!found) return fail(c, 404, "not_found");
    const cursor = parseCursor(after);
    const comments = await space(c.env, found.post.communityId).comments(
      postId,
      found.access.viewer,
      cursor && cursor.id !== null ? { createdAt: cursor.t, id: cursor.id } : null,
      limit + 1,
    );
    const page = comments.slice(0, limit);
    const last = page.at(-1);
    return c.json(
      {
        comments: await named(c.env, page),
        next: comments.length > limit && last ? `${last.createdAt}-${last.commentId}` : null,
      },
      200,
    );
  });

  app.openapi(createCommentRoute, async (c) => {
    const { accountId } = c.var.session;
    const { postId } = c.req.valid("param");
    const found = await postAccess(c.env, accountId, postId);
    if (!found) return fail(c, 404, "not_found");
    if (!canTakePart(found.access)) return fail(c, 403, refusal(found.access));
    const { communityId } = found.post;
    await noteAuthor(c.env, communityId, accountId);
    const added = await space(c.env, communityId).addComment({
      commentId: newCommentId(postId),
      postId,
      author: accountId,
      body: c.req.valid("json").body,
      createdAt: Date.now(),
    });
    const [comment] = added ? await named(c.env, [added]) : [];
    if (!comment) return fail(c, 404, "not_found");
    log("comment.created", { accountId, communityId, postId });
    return c.json(comment, 200);
  });

  app.openapi(deleteCommentRoute, async (c) => {
    const { accountId } = c.var.session;
    const { commentId } = c.req.valid("param");
    const postId = commentId.slice(0, Math.max(0, commentId.lastIndexOf("-")));
    const found = postId ? await postAccess(c.env, accountId, postId) : null;
    if (!found) return fail(c, 404, "not_found");
    const stub = space(c.env, found.post.communityId);
    const comment = await stub.comment(commentId);
    if (!comment || found.access.viewer.hidden.includes(comment.author)) {
      return fail(c, 404, "not_found");
    }
    if (comment.author !== accountId) return fail(c, 403, "not_author");
    await stub.deleteComment(commentId);
    log("comment.deleted", { accountId, communityId: found.post.communityId, postId });
    return c.body(null, 204);
  });

  app.openapi(reactRoute, async (c) => {
    const { accountId } = c.var.session;
    const { postId } = c.req.valid("param");
    const found = await postAccess(c.env, accountId, postId);
    if (!found) return fail(c, 404, "not_found");
    if (!canTakePart(found.access)) return fail(c, 403, refusal(found.access));
    await noteAuthor(c.env, found.post.communityId, accountId);
    const set = await space(c.env, found.post.communityId).react(
      postId,
      accountId,
      c.req.valid("json").kind,
    );
    return set ? c.body(null, 204) : fail(c, 404, "not_found");
  });

  app.openapi(unreactRoute, async (c) => {
    const { accountId } = c.var.session;
    const { postId } = c.req.valid("param");
    const found = await postAccess(c.env, accountId, postId);
    if (!found) return fail(c, 404, "not_found");
    await space(c.env, found.post.communityId).react(postId, accountId, null);
    return c.body(null, 204);
  });
}
