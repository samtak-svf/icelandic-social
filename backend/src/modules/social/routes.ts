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
import { communityImagesRoute } from "../../api/community-gallery.ts";
import { likeCommentRoute, unlikeCommentRoute } from "../../api/social-hub.ts";
import type { AppEnv } from "../../app.ts";
import { space, withinLimit } from "../../env/index.ts";
import { blockedEither } from "../../identity/index.ts";
import { fail } from "../../errors.ts";
import { log } from "../../log.ts";
import { markRead } from "../communities/index.ts";
import { notice } from "../jobs/index.ts";
import { cardRoutes } from "./cards.ts";
import { commentAccess, postAccess, refusal, replyRefusal, spaceAccess } from "./access.ts";
import { authors, named } from "./bylines.ts";
import {
  communityImages,
  deleteCommentMedia,
  deleteKeys,
  postImageOwner,
  readImage,
  upload,
} from "./media.ts";
import {
  communityPosts,
  createPost,
  feed,
  noteAuthor,
  parseCursor,
  render,
  unindex,
  writeComment,
} from "./posts.ts";

// The routes of a community's content (decisions 0060, 0063). Each asks
// access.ts whether the caller may see what it names before anything else.
// A log line carries ids and counts, never a text or an image (0008).

export function socialRoutes(app: OpenAPIHono<AppEnv>): void {
  cardRoutes(app);

  app.openapi(createPostRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const access = await spaceAccess(c.env, accountId, communityId);
    if (!access) return fail(c, 404, "not_found");
    const refused = refusal(access);
    if (refused) return fail(c, 403, refused);
    const input = c.req.valid("json");
    if (input.body === "" && input.media.length === 0) return fail(c, 400, "invalid_request");
    const created = await createPost(c.env, communityId, accountId, input);
    if (created === "invalid_media") return fail(c, 400, "invalid_media");
    const author = (await authors(c.env, [accountId], communityId)).get(accountId);
    if (!author) return fail(c, 404, "not_found");
    log("post.created", { accountId, communityId, postId: created.postId });
    return c.json(
      { ...created, communityId, author, state: "visible" as const, pinned: false },
      200,
    );
  });

  app.openapi(uploadSocialMediaRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const body = c.req.raw.body;
    // A refusal cancels the body, so the client stops sending it.
    const refuse = async <T>(answer: T) => (await body?.cancel(), answer);
    const access = await spaceAccess(c.env, accountId, communityId);
    if (!access) return refuse(fail(c, 404, "not_found"));
    const refused = refusal(access);
    if (refused) return refuse(fail(c, 403, refused));
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
    const { before, limit, q } = c.req.valid("query");
    const access = await spaceAccess(c.env, c.var.session.accountId, communityId);
    if (!access) return fail(c, 404, "not_found");
    // Featured posts keep their place in time, marked (decision 0088).
    const featured = new Set(await space(c.env, communityId).featured());
    const page = await communityPosts(c.env, communityId, access.viewer, before, limit, q);
    // Opening the feed (its first page, not a search) is what reading the
    // community means: the member's unread count goes to zero (decision 0080).
    if (before === undefined && !q?.trim() && access.standing.role !== null) {
      await markRead(c.env, c.var.session.accountId, communityId).run();
    }
    return c.json(
      { posts: await render(c.env, page.rows, access.viewer, featured), next: page.next },
      200,
    );
  });

  app.openapi(communityImagesRoute, async (c) => {
    const { communityId } = c.req.valid("param");
    const { cursor, limit } = c.req.valid("query");
    const access = await spaceAccess(c.env, c.var.session.accountId, communityId);
    if (!access) return fail(c, 404, "not_found");
    const page = await communityImages(c.env, communityId, access.viewer.hidden, cursor, limit);
    return c.json({ images: page.rows, next: page.next }, 200);
  });

  app.openapi(feedRoute, async (c) => {
    const { accountId } = c.var.session;
    const { before, limit } = c.req.valid("query");
    const page = await feed(c.env, accountId, before, limit);
    // The feed's SQL left out the posts of the blocked; the spaces hide their comments and reactions.
    const hidden = await blockedEither(c.env, accountId);
    const viewer = { account: accountId, hidden, moderator: false };
    return c.json({ posts: await render(c.env, page.rows, viewer), next: page.next }, 200);
  });

  app.openapi(getPostRoute, async (c) => {
    const found = await postAccess(c.env, c.var.session.accountId, c.req.valid("param").postId);
    if (!found) return fail(c, 404, "not_found");
    const featured = new Set(await space(c.env, found.post.communityId).featured());
    const [post] = await render(c.env, [found.post], found.access.viewer, featured);
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
    const owner = found && (await postImageOwner(c.env, found.post.communityId, postId, mediaId));
    if (!found || !owner) return fail(c, 404, "not_found");
    // A comment's image is served while the comment is: never once it is removed,
    // and a hidden one's only to a moderator, as commentAccess decides (decision 0082).
    if (owner.commentId !== null) {
      const shown = await commentAccess(c.env, c.var.session.accountId, owner.commentId);
      if (!shown || shown.comment.state === "removed") return fail(c, 404, "not_found");
    }
    const image = await readImage(c.env, found.post.communityId, mediaId);
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
        comments: await named(c.env, page, found.post.communityId),
        next: comments.length > limit && last ? `${last.createdAt}-${last.commentId}` : null,
      },
      200,
    );
  });

  app.openapi(createCommentRoute, async (c) => {
    const { accountId } = c.var.session;
    const { postId } = c.req.valid("param");
    const input = c.req.valid("json");
    // A comment is a text, an image or both, never neither (decision 0082).
    if (input.body === "" && input.media.length === 0) return fail(c, 400, "invalid_request");
    const written = await writeComment(
      c.env,
      accountId,
      postId,
      input.body,
      input.parentCommentId ?? null,
      input.media,
    );
    if (written && "refused" in written) return fail(c, 403, written.refused);
    if (written && "invalidParent" in written) return fail(c, 400, "invalid_parent_comment");
    if (written && "invalidMedia" in written) return fail(c, 400, "invalid_media");
    const [comment] = written
      ? await named(c.env, [written.comment], written.post.communityId)
      : [];
    if (!written || !comment) return fail(c, 404, "not_found");
    log("comment.created", { accountId, communityId: written.post.communityId, postId });
    return c.json(comment, 200);
  });

  app.openapi(deleteCommentRoute, async (c) => {
    const { accountId } = c.var.session;
    const found = await commentAccess(c.env, accountId, c.req.valid("param").commentId);
    if (!found) return fail(c, 404, "not_found");
    const { post, comment } = found;
    if (comment.author !== accountId) return fail(c, 403, "not_author");
    await space(c.env, post.communityId).deleteComment(comment.commentId);
    await deleteCommentMedia(c.env, comment.commentId);
    log("comment.deleted", { accountId, communityId: post.communityId, postId: post.postId });
    return c.body(null, 204);
  });

  app.openapi(reactRoute, async (c) => {
    const { accountId } = c.var.session;
    const { postId } = c.req.valid("param");
    const found = await postAccess(c.env, accountId, postId);
    if (!found) return fail(c, 404, "not_found");
    const refused = replyRefusal(found.access, found.post);
    if (refused) return fail(c, 403, refused);
    const { communityId, authorId } = found.post;
    // One notice for each account's reaction to a post, whatever it changes to.
    await noteAuthor(c.env, communityId, accountId, [
      notice(c.env, `${postId}:${accountId}`, {
        kind: "reaction",
        accountId: authorId,
        actorId: accountId,
        communityId,
        postId,
      }),
    ]);
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

  // A comment's 👍 (decision 0080) follows the rule of commenting and tells
  // nobody, so no notice is written. noteAuthor still records that the account
  // wrote in the space, so deleting the account reaches its likes.
  app.openapi(likeCommentRoute, async (c) => {
    const { accountId } = c.var.session;
    const found = await commentAccess(c.env, accountId, c.req.valid("param").commentId);
    if (!found) return fail(c, 404, "not_found");
    const refused = replyRefusal(found.access, found.post);
    if (refused) return fail(c, 403, refused);
    if (found.access.between.includes(found.comment.author)) return fail(c, 403, "blocked");
    const { communityId } = found.post;
    await noteAuthor(c.env, communityId, accountId);
    const liked = await space(c.env, communityId).likeComment(
      found.comment.commentId,
      accountId,
      true,
    );
    return liked ? c.body(null, 204) : fail(c, 404, "not_found");
  });

  app.openapi(unlikeCommentRoute, async (c) => {
    const { accountId } = c.var.session;
    const found = await commentAccess(c.env, accountId, c.req.valid("param").commentId);
    if (!found) return fail(c, 404, "not_found");
    await space(c.env, found.post.communityId).likeComment(
      found.comment.commentId,
      accountId,
      false,
    );
    return c.body(null, 204);
  });
}
