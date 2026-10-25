import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, OpaqueId } from "./common.ts";
import { Author, json, NO_POST, page, PostId, PostPage } from "./social.ts";

// Anonymous posts waiting for a moderator (decision 0091). Nothing here names
// a post's author, except the reveal, which is logged.

const tags = ["moderation"];
const NOT_MODERATOR = {
  403: errorResponse("not_permitted: only the community's owner and moderators, and Samtak's"),
};

export const anonymousQueueRoute = createRoute({
  method: "get",
  path: "/v1/communities/{communityId}/anonymous",
  operationId: "listPendingAnonymousPosts",
  tags,
  summary: "The anonymous posts waiting for approval, newest first",
  description:
    "Each post has a null author, as every reader but its author sees it: approving does not reveal (decision 0091).",
  security: ACCOUNT,
  request: { params: z.object({ communityId: OpaqueId }), query: z.object(page) },
  responses: {
    200: json("A page", PostPage),
    ...AUTHED,
    ...NOT_MODERATOR,
    404: errorResponse("not_found: no such community the caller can see"),
  },
});

const post = z.object({ postId: PostId });

export const approveAnonymousRoute = createRoute({
  method: "post",
  path: "/v1/posts/{postId}/approve",
  operationId: "approveAnonymousPost",
  tags,
  summary: "Publish an anonymous post",
  description:
    "The post appears in the community's feed as of now, still without its author. Nobody is told, and the author is not revealed.",
  security: ACCOUNT,
  request: { params: post },
  responses: {
    204: { description: "Published" },
    ...AUTHED,
    ...NOT_MODERATOR,
    ...NO_POST,
  },
});

export const declineAnonymousRoute = createRoute({
  method: "post",
  path: "/v1/posts/{postId}/decline",
  operationId: "declineAnonymousPost",
  tags,
  summary: "Decline an anonymous post",
  description: "Deletes the post and tells its author, and nobody else, that it was not published.",
  security: ACCOUNT,
  request: { params: post },
  responses: {
    204: { description: "Declined and deleted" },
    ...AUTHED,
    ...NOT_MODERATOR,
    ...NO_POST,
  },
});

export const revealAuthorRoute = createRoute({
  method: "post",
  path: "/v1/posts/{postId}/reveal",
  operationId: "revealAuthor",
  tags,
  summary: "Reveal the author of an anonymous post",
  description:
    "For the community's owner and moderators, and Samtak's. The moderation log gets an entry naming who revealed, never whom (decision 0091).",
  security: ACCOUNT,
  request: { params: post },
  responses: {
    200: json("The author", Author),
    ...AUTHED,
    ...NOT_MODERATOR,
    ...NO_POST,
  },
});
