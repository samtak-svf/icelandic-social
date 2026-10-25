import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse } from "./common.ts";
import { OptionId } from "./poll-schema.ts";
import { json, MEMBERS_REPLY, Post, PostId } from "./social.ts";

// Voting in a poll and closing it (decision 0090). Nothing in an answer says
// who voted or how.

const post = z.object({ postId: PostId });
const tags = ["social"];

const NO_POLL = {
  404: errorResponse("not_found: no such post the caller can see, or it is not a poll"),
};

export const voteRoute = createRoute({
  method: "put",
  path: "/v1/posts/{postId}/vote",
  operationId: "votePoll",
  tags,
  summary: "Vote in a poll, or change the caller's vote",
  description:
    "Whoever may comment may vote, once; voting again changes the vote (decision 0090). Nobody is told, and no route says who voted or how.",
  security: ACCOUNT,
  request: {
    params: post,
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ optionId: OptionId }) } },
    },
  },
  responses: {
    200: json("The poll's post, as the caller now sees it", Post),
    400: errorResponse("invalid_request: the post has no such option"),
    409: errorResponse("poll_closed: the poll takes no more votes"),
    ...AUTHED,
    ...MEMBERS_REPLY,
    ...NO_POLL,
  },
});

export const withdrawVoteRoute = createRoute({
  method: "delete",
  path: "/v1/posts/{postId}/vote",
  operationId: "withdrawVote",
  tags,
  summary: "Withdraw the caller's vote in a poll",
  description: "Withdrawing when there is no vote changes nothing (decision 0090).",
  security: ACCOUNT,
  request: { params: post },
  responses: {
    200: json("The poll's post, as the caller now sees it", Post),
    409: errorResponse("poll_closed: the poll takes no more changes"),
    ...AUTHED,
    ...NO_POLL,
  },
});

export const closePollRoute = createRoute({
  method: "post",
  path: "/v1/posts/{postId}/poll/close",
  operationId: "closePoll",
  tags,
  summary: "Close a poll",
  description:
    "The post's author, or the community's owner or a moderator, closes it; a moderator's close is in the moderation log. Closing a closed poll changes and logs nothing. A closed poll shows its results to every reader (decision 0090).",
  security: ACCOUNT,
  request: { params: post },
  responses: {
    200: json("The post, closed", Post),
    ...AUTHED,
    403: errorResponse("not_permitted: only its author and the community's moderators close it"),
    ...NO_POLL,
  },
});
