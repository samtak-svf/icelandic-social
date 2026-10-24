import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, INVALID, OpaqueId } from "./common.ts";
import { CommentId, Cursor, json, MediaId, NO_COMMUNITY, PostId } from "./social.ts";

// The images tab of a community (decision 0089): one paged read over the
// media references that posts and comments already store.

const CommunityImage = z
  .object({
    mediaId: MediaId,
    postId: PostId,
    commentId: CommentId.nullable().openapi({
      description: "The comment that carries the image; null for a post's own image",
    }),
    width: z.int(),
    height: z.int(),
    createdAt: z.int().openapi({ description: "Unix milliseconds" }),
  })
  .openapi("CommunityImage", {
    description: "An image to fetch with `getPostMedia` under its `postId` (decision 0089)",
  });

export const communityImagesRoute = createRoute({
  method: "get",
  path: "/v1/communities/{communityId}/images",
  operationId: "listCommunityImages",
  tags: ["social"],
  summary: "The images in a community's posts and comments, newest first (decision 0089)",
  description:
    "Only images of posts and comments the caller may see: a hidden or removed post's or comment's images, and a blocked account's, are left out. Follow `next` until it is null.",
  security: ACCOUNT,
  request: {
    params: z.object({ communityId: OpaqueId }),
    query: z.object({
      cursor: Cursor.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
  responses: {
    200: json(
      "A page",
      z
        .object({
          images: z.array(CommunityImage),
          next: z.string().nullable().openapi({
            description: "The cursor of the next, older page, or null when there is none",
          }),
        })
        .openapi("CommunityImagePage"),
    ),
    ...INVALID,
    ...AUTHED,
    ...NO_COMMUNITY,
  },
});
