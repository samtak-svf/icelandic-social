import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, RATE_LIMITED } from "./common.ts";

// A community's content (decisions 0060, 0063): posts, comments on them and
// one reaction per account on each. It is hosted and access-controlled, not
// end-to-end encrypted. Every route asks the same question first: may the
// caller see this post? A post it may not see answers 404, like one that is
// not there, so the answer says nothing about a private community or a block.

/** The largest image a post takes, before it is re-encoded. */
export const MAX_SOCIAL_UPLOAD = 10 * 1024 * 1024;

/** How many images a post holds. */
const MAX_POST_MEDIA = 4;

/** The reactions there are: one per account on a post, from this fixed set. */
export const REACTIONS = ["like", "love", "laugh", "wow", "sad"] as const;

const CommunityId = OpaqueId;
const PostId = OpaqueId.openapi({ example: "p_3f9a1b2c3d4e5f60718293a4b5c6d7e8" });
const CommentId = OpaqueId.openapi({
  example: "p_3f9a1b2c3d4e5f60718293a4b5c6d7e8-0a1b2c3d4e5f6071",
  description: "The post's id, a hyphen, and the comment's own part",
});
const MediaId = OpaqueId.openapi({ example: "sm_3f9a1b2c3d4e5f60718293a4b5c6d7e8" });

const Reaction = z.enum(REACTIONS);

const State = z.enum(["visible", "hidden", "removed"]).openapi({
  description: "Only a moderator sees what is not visible: hidden or removed by a moderator",
});

export const Author = z
  .object({ accountId: OpaqueId, name: z.string().nullable(), verified: z.boolean() })
  .openapi("Author");

export const Media = z
  .object({ mediaId: MediaId, width: z.int(), height: z.int() })
  .openapi("SocialMedia", { description: "A re-encoded WebP image" });

const Post = z
  .object({
    postId: PostId,
    communityId: CommunityId,
    author: Author,
    body: z.string(),
    media: z.array(Media),
    createdAt: z.int().openapi({ description: "Unix milliseconds" }),
    reactions: z
      .array(z.object({ kind: Reaction, count: z.int() }))
      .openapi({ description: "Each reaction the caller can see, with its count" }),
    myReaction: Reaction.nullable(),
    commentCount: z.int(),
    state: State,
    pinned: z.boolean().openapi({
      description:
        "A moderator pinned it to the top of the community (decision 0080). On a community's posts it is the first post of the first page, and only there; `getFeed` never pins",
    }),
  })
  .openapi("Post");

const Comment = z
  .object({
    commentId: CommentId,
    postId: PostId,
    parentCommentId: CommentId.nullable().openapi({
      description:
        "The top-level comment this replies to; null on a top-level comment (decision 0071)",
    }),
    author: Author,
    body: z.string(),
    createdAt: z.int().openapi({ description: "Unix milliseconds" }),
    state: State,
    likes: z.int().openapi({
      description:
        "How many accounts liked it, but those a block hides from the caller (decision 0080)",
    }),
    liked: z.boolean().openapi({ description: "The caller liked it" }),
  })
  .openapi("Comment");

const Cursor = z
  .string()
  .regex(/^\d{1,16}(-[A-Za-z0-9_-]{1,160})?$/)
  .openapi({ description: "The `next` of the page before" });

const page = {
  before: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};

const PostPage = z
  .object({
    posts: z.array(Post),
    next: z.string().nullable().openapi({
      description:
        "The cursor of the next, older page, or null when there is none. A page may be short, or empty, with more after it",
    }),
  })
  .openapi("PostPage");

const CommentPage = z
  .object({ comments: z.array(Comment), next: z.string().nullable() })
  .openapi("CommentPage");

const json = <T extends z.ZodType>(description: string, schema: T) => ({
  description,
  content: { "application/json": { schema } },
});

const NO_POST = { 404: errorResponse("not_found: no such post the caller can see") };
const NO_COMMUNITY = { 404: errorResponse("not_found: no such community the caller can see") };
const MEMBERS_POST = {
  403: errorResponse(
    "not_a_member: only members post, comment and react; read_only: the community takes nothing new; muted: a moderator muted the caller here for now",
  ),
};
export const MEMBERS_REPLY = {
  403: errorResponse(
    "not_a_member: only members comment and react; read_only: the community takes nothing new; muted: a moderator muted the caller here for now; not_permitted: the post was hidden or removed; blocked: a block stands between the caller and the post's author",
  ),
};

const post = z.object({ postId: PostId });
const tags = ["social"];

export const createPostRoute = createRoute({
  method: "post",
  path: "/v1/communities/{communityId}/posts",
  operationId: "createPost",
  tags,
  summary: "Post in a community",
  description:
    "A post has a text, images uploaded to the community first, or both. It is not end-to-end encrypted.",
  security: ACCOUNT,
  request: {
    params: z.object({ communityId: CommunityId }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            body: z.string().trim().max(5000).default(""),
            media: z.array(MediaId).max(MAX_POST_MEDIA).default([]),
          }),
        },
      },
    },
  },
  responses: {
    200: json("Posted", Post),
    400: errorResponse(
      "invalid_request: neither a text nor an image; invalid_media: an image that is not the caller's upload to this community, or is already in a post",
    ),
    ...AUTHED,
    ...MEMBERS_POST,
    ...NO_COMMUNITY,
  },
});

export const uploadSocialMediaRoute = createRoute({
  method: "post",
  path: "/v1/communities/{communityId}/media",
  operationId: "uploadSocialMedia",
  tags,
  summary: "Upload an image for a post in a community",
  description:
    "The body is an image (JPEG, PNG, WebP, GIF or AVIF) of at most 10 MB, with a Content-Length. The server re-encodes it to a WebP no larger than 2048 pixels a side, without metadata, and keeps only that. An image no post takes within a day is deleted.",
  security: ACCOUNT,
  request: {
    params: z.object({ communityId: CommunityId }),
    body: {
      required: true,
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
  },
  responses: {
    200: json("Stored", Media),
    400: errorResponse(
      "invalid_request: no Content-Length, or a body of another length; invalid_image: not an image the server takes",
    ),
    413: errorResponse("too_large: more than 10 MB"),
    ...RATE_LIMITED,
    ...AUTHED,
    ...MEMBERS_POST,
    ...NO_COMMUNITY,
  },
});

export const communityPostsRoute = createRoute({
  method: "get",
  path: "/v1/communities/{communityId}/posts",
  operationId: "listCommunityPosts",
  tags,
  summary: "A community's posts, newest first",
  description:
    "`q` keeps the posts whose text contains it, without case, beside the pages: follow `next` with the same `q`.",
  security: ACCOUNT,
  request: {
    params: z.object({ communityId: CommunityId }),
    query: z.object({ ...page, q: z.string().trim().min(1).max(80).optional() }),
  },
  responses: {
    200: json("A page", PostPage),
    ...INVALID,
    ...AUTHED,
    ...NO_COMMUNITY,
  },
});

export const feedRoute = createRoute({
  method: "get",
  path: "/v1/feed",
  operationId: "getFeed",
  tags,
  summary: "The posts of the caller's communities, newest first",
  description:
    "Read a time window at a time, so a page can be short or empty while older posts remain: follow `next` until it is null.",
  security: ACCOUNT,
  request: { query: z.object(page) },
  responses: { 200: json("A page", PostPage), ...INVALID, ...AUTHED },
});

export const getPostRoute = createRoute({
  method: "get",
  path: "/v1/posts/{postId}",
  operationId: "getPost",
  tags,
  summary: "One post",
  security: ACCOUNT,
  request: { params: post },
  responses: { 200: json("The post", Post), ...INVALID, ...AUTHED, ...NO_POST },
});

export const deletePostRoute = createRoute({
  method: "delete",
  path: "/v1/posts/{postId}",
  operationId: "deletePost",
  tags,
  summary: "Delete the caller's own post, its comments, reactions and images",
  security: ACCOUNT,
  request: { params: post },
  responses: {
    204: { description: "Deleted" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse("not_author: only its author deletes a post"),
    ...NO_POST,
  },
});

export const getPostMediaRoute = createRoute({
  method: "get",
  path: "/v1/posts/{postId}/media/{mediaId}",
  operationId: "getPostMedia",
  tags,
  summary: "An image of a post, as WebP",
  security: ACCOUNT,
  request: { params: z.object({ postId: PostId, mediaId: MediaId }) },
  responses: {
    200: {
      description: "The image",
      content: { "image/webp": { schema: z.string().openapi({ format: "binary" }) } },
    },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: no such image in a post the caller can see"),
  },
});

export const listCommentsRoute = createRoute({
  method: "get",
  path: "/v1/posts/{postId}/comments",
  operationId: "listComments",
  tags,
  summary: "A post's comments, oldest first",
  security: ACCOUNT,
  request: {
    params: post,
    query: z.object({
      after: Cursor.optional().openapi({ description: "The `next` of the page before" }),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: { 200: json("A page", CommentPage), ...INVALID, ...AUTHED, ...NO_POST },
});

export const createCommentRoute = createRoute({
  method: "post",
  path: "/v1/posts/{postId}/comments",
  operationId: "createComment",
  tags,
  summary: "Comment on a post",
  description:
    "With `parentCommentId` the comment is a reply to a top-level comment on this post; " +
    "a parent that is itself a reply, of another post, or not visible answers " +
    "400 invalid_parent_comment (decision 0071).",
  security: ACCOUNT,
  request: {
    params: post,
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({
            body: z.string().trim().min(1).max(2000),
            parentCommentId: CommentId.nullable().optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: json("Commented", Comment),
    ...INVALID,
    ...AUTHED,
    ...MEMBERS_REPLY,
    ...NO_POST,
  },
});

export const deleteCommentRoute = createRoute({
  method: "delete",
  path: "/v1/comments/{commentId}",
  operationId: "deleteComment",
  tags,
  summary: "Delete the caller's own comment",
  security: ACCOUNT,
  request: { params: z.object({ commentId: CommentId }) },
  responses: {
    204: { description: "Deleted" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse("not_author: only its author deletes a comment"),
    404: errorResponse("not_found: no such comment the caller can see"),
  },
});

export const reactRoute = createRoute({
  method: "put",
  path: "/v1/posts/{postId}/reaction",
  operationId: "react",
  tags,
  summary: "Set the caller's reaction to a post, replacing any it had",
  security: ACCOUNT,
  request: {
    params: post,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ kind: Reaction }) } },
    },
  },
  responses: {
    204: { description: "Set" },
    ...INVALID,
    ...AUTHED,
    ...MEMBERS_REPLY,
    ...NO_POST,
  },
});

export const unreactRoute = createRoute({
  method: "delete",
  path: "/v1/posts/{postId}/reaction",
  operationId: "unreact",
  tags,
  summary: "Remove the caller's reaction to a post",
  security: ACCOUNT,
  request: { params: post },
  responses: { 204: { description: "Removed" }, ...INVALID, ...AUTHED, ...NO_POST },
});
