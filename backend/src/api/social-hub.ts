import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId } from "./common.ts";
import { MEMBERS_REPLY } from "./social.ts";

// The hub's additions to a community's content (decision 0080): a like on a
// comment and the one pinned post. Kept apart from `social.ts` to keep both small.

const CommunityId = OpaqueId;
const PostId = OpaqueId.openapi({ example: "p_3f9a1b2c3d4e5f60718293a4b5c6d7e8" });
const CommentId = OpaqueId.openapi({
  example: "p_3f9a1b2c3d4e5f60718293a4b5c6d7e8-0a1b2c3d4e5f6071",
  description: "The post's id, a hyphen, and the comment's own part",
});
const tags = ["social"];

export const likeCommentRoute = createRoute({
  method: "put",
  path: "/v1/comments/{commentId}/like",
  operationId: "likeComment",
  tags,
  summary: "Like a comment",
  description:
    "One 👍 per account and comment; liking twice is one like, and nobody is notified (decision 0080). The same rule as commenting applies.",
  security: ACCOUNT,
  request: { params: z.object({ commentId: CommentId }) },
  responses: {
    204: { description: "Liked" },
    ...INVALID,
    ...AUTHED,
    ...MEMBERS_REPLY,
    404: errorResponse("not_found: no such comment the caller can see"),
  },
});

export const unlikeCommentRoute = createRoute({
  method: "delete",
  path: "/v1/comments/{commentId}/like",
  operationId: "unlikeComment",
  tags,
  summary: "Take back a like on a comment",
  security: ACCOUNT,
  request: { params: z.object({ commentId: CommentId }) },
  responses: {
    204: { description: "Not liked, whether it was or not" },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: no such comment the caller can see"),
  },
});

const pinnedPost = z.object({ communityId: CommunityId, postId: PostId });

export const pinPostRoute = createRoute({
  method: "put",
  path: "/v1/communities/{communityId}/posts/{postId}/pin",
  operationId: "pinPost",
  tags,
  summary: "Pin a post to the top of the community",
  description:
    "One post is pinned at a time: pinning another replaces it. Only the owner and the moderators pin, and each change is a moderation log entry. A removed or deleted post is unpinned (decision 0080).",
  security: ACCOUNT,
  request: { params: pinnedPost },
  responses: {
    204: { description: "Pinned, or already" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse("not_permitted: only the owner and the moderators pin"),
    404: errorResponse("not_found: no such post the caller can see in that community"),
  },
});

export const unpinPostRoute = createRoute({
  method: "delete",
  path: "/v1/communities/{communityId}/posts/{postId}/pin",
  operationId: "unpinPost",
  tags,
  summary: "Unpin the community's pinned post",
  security: ACCOUNT,
  request: { params: pinnedPost },
  responses: {
    204: { description: "Not pinned, whether it was or not" },
    ...INVALID,
    ...AUTHED,
    403: errorResponse("not_permitted: only the owner and the moderators unpin"),
    404: errorResponse("not_found: no such post the caller can see in that community"),
  },
});
