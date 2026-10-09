import { createRoute, z } from "@hono/zod-openapi";
import { AUTHED, DEVICE_TOKEN, errorResponse, INVALID, OpaqueId, RATE_LIMITED } from "./common.ts";

// Fljótið and the walls (decision 0034): public to every signed-in account,
// not end-to-end encrypted. Block (0024) is applied by the server.

/** The reactions a post can get, one per account; the apps draw them. */
export const REACTIONS = ["heart", "thumbs_up", "laugh", "wow", "sad"] as const;

/** The most characters a post or a reply holds (0034). */
const MAX_BODY = 2000;

const Author = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable(),
    verified: z.boolean().openapi({ description: "Kenni vouches for the name (decision 0033)" }),
  })
  .openapi("Author");

const Reaction = z.enum(REACTIONS).openapi("Reaction");

const Post = z
  .object({
    postId: OpaqueId,
    author: Author,
    body: z.string(),
    createdAt: z.int().openapi({ description: "Unix milliseconds" }),
    replyCount: z.int().openapi({ description: "Replies the caller can see" }),
    reactions: z.object(
      Object.fromEntries(REACTIONS.map((r) => [r, z.int()])) as Record<
        (typeof REACTIONS)[number],
        z.ZodInt
      >,
    ),
    myReaction: Reaction.nullable(),
  })
  .openapi("Post");

const Reply = z
  .object({
    replyId: OpaqueId,
    postId: OpaqueId,
    author: Author,
    body: z.string(),
    createdAt: z.int().openapi({ description: "Unix milliseconds" }),
  })
  .openapi("Reply");

const next = z
  .string()
  .nullable()
  .openapi({ description: "The cursor of the next page, null on the last" });

const PostPage = z
  .object({ posts: z.array(Post).openapi({ description: "Newest first" }), next })
  .openapi("PostPage");

const ReplyPage = z
  .object({ replies: z.array(Reply).openapi({ description: "Oldest first" }), next })
  .openapi("ReplyPage");

/** Text of a post or a reply: not blank, at most MAX_BODY characters. */
const Body = z
  .object({
    body: z
      .string()
      .max(MAX_BODY)
      .refine((s) => s.trim().length > 0, "blank"),
  })
  .openapi("NewPost");

const limit = z.coerce.number().int().min(1).max(50).default(20);
const cursor = z.string().min(1).max(200).optional().openapi({ description: "From `next`" });

const postParam = z.object({ postId: OpaqueId });
const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { "application/json": { schema } },
});

const BAD_CURSOR = {
  400: errorResponse("invalid_request: the query, or a cursor not from `next`"),
};
const NOT_FOUND = {
  404: errorResponse("not_found: no such post, or one by an account you blocked"),
};
const BLOCKED = { 403: errorResponse("blocked: the post's author has blocked this account") };
const OWN = {
  403: errorResponse("not_author: only its author may delete it"),
  404: errorResponse("not_found: no such item"),
};

export const feedRoute = createRoute({
  method: "get",
  path: "/v1/feed",
  operationId: "getFeed",
  tags: ["posts"],
  summary: "Fljótið: every account's posts, newest first",
  security: DEVICE_TOKEN,
  request: { query: z.object({ before: cursor, limit }) },
  responses: { 200: json(PostPage, "A page"), ...BAD_CURSOR, ...AUTHED },
});

export const wallRoute = createRoute({
  method: "get",
  path: "/v1/accounts/{accountId}/posts",
  operationId: "getWall",
  tags: ["posts"],
  summary: "An account's wall: its own posts, newest first",
  security: DEVICE_TOKEN,
  request: {
    params: z.object({ accountId: OpaqueId }),
    query: z.object({ before: cursor, limit }),
  },
  responses: {
    200: json(PostPage, "A page; empty for an account the caller blocked"),
    ...BAD_CURSOR,
    404: errorResponse("not_found: no such account"),
    ...AUTHED,
  },
});

export const createPostRoute = createRoute({
  method: "post",
  path: "/v1/posts",
  operationId: "createPost",
  tags: ["posts"],
  summary: "Post to Fljótið and the caller's wall",
  security: DEVICE_TOKEN,
  request: { body: { content: { "application/json": { schema: Body } }, required: true } },
  responses: { 201: json(Post, "The post"), ...INVALID, ...RATE_LIMITED, ...AUTHED },
});

export const getPostRoute = createRoute({
  method: "get",
  path: "/v1/posts/{postId}",
  operationId: "getPost",
  tags: ["posts"],
  summary: "One post",
  security: DEVICE_TOKEN,
  request: { params: postParam },
  responses: { 200: json(Post, "The post"), ...INVALID, ...NOT_FOUND, ...AUTHED },
});

export const deletePostRoute = createRoute({
  method: "delete",
  path: "/v1/posts/{postId}",
  operationId: "deletePost",
  tags: ["posts"],
  summary: "Delete one of the caller's posts, with its replies and reactions",
  security: DEVICE_TOKEN,
  request: { params: postParam },
  responses: { 204: { description: "Deleted" }, ...INVALID, ...OWN, ...AUTHED },
});

export const reactRoute = createRoute({
  method: "put",
  path: "/v1/posts/{postId}/reaction",
  operationId: "reactToPost",
  tags: ["posts"],
  summary: "Set the caller's one reaction to a post",
  security: DEVICE_TOKEN,
  request: {
    params: postParam,
    body: {
      content: { "application/json": { schema: z.object({ reaction: Reaction }) } },
      required: true,
    },
  },
  responses: {
    204: { description: "Set, replacing any other" },
    ...INVALID,
    ...BLOCKED,
    ...NOT_FOUND,
    ...AUTHED,
  },
});

export const unreactRoute = createRoute({
  method: "delete",
  path: "/v1/posts/{postId}/reaction",
  operationId: "unreactToPost",
  tags: ["posts"],
  summary: "Take back the caller's reaction",
  security: DEVICE_TOKEN,
  request: { params: postParam },
  responses: {
    204: { description: "No reaction, whether there was one or not" },
    ...INVALID,
    ...AUTHED,
  },
});

export const listRepliesRoute = createRoute({
  method: "get",
  path: "/v1/posts/{postId}/replies",
  operationId: "listReplies",
  tags: ["posts"],
  summary: "A post's replies, oldest first",
  security: DEVICE_TOKEN,
  request: { params: postParam, query: z.object({ after: cursor, limit }) },
  responses: { 200: json(ReplyPage, "A page"), ...BAD_CURSOR, ...NOT_FOUND, ...AUTHED },
});

export const createReplyRoute = createRoute({
  method: "post",
  path: "/v1/posts/{postId}/replies",
  operationId: "createReply",
  tags: ["posts"],
  summary: "Reply to a post",
  security: DEVICE_TOKEN,
  request: {
    params: postParam,
    body: { content: { "application/json": { schema: Body } }, required: true },
  },
  responses: {
    201: json(Reply, "The reply"),
    ...INVALID,
    ...BLOCKED,
    ...NOT_FOUND,
    ...RATE_LIMITED,
    ...AUTHED,
  },
});

export const deleteReplyRoute = createRoute({
  method: "delete",
  path: "/v1/replies/{replyId}",
  operationId: "deleteReply",
  tags: ["posts"],
  summary: "Delete one of the caller's replies",
  security: DEVICE_TOKEN,
  request: { params: z.object({ replyId: OpaqueId }) },
  responses: { 204: { description: "Deleted" }, ...INVALID, ...OWN, ...AUTHED },
});
