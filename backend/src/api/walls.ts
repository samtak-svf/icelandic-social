import { createRoute, z } from "@hono/zod-openapi";
import { MAX_PHOTO_UPLOAD } from "./accounts.ts";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, RATE_LIMITED } from "./common.ts";
import { COMMUNITY_IMAGE_PAGE } from "./community-gallery.ts";
import { Framing, FRAME_NAMES } from "./image-frames.ts";
import { reason } from "./moderation.ts";
import {
  CommentId,
  Cursor,
  json,
  MAX_BIO,
  MediaId,
  page,
  Post,
  POST_FIELDS,
  PostId,
  PostPage,
  uploadSocialMediaRoute,
  WallAudience,
} from "./social.ts";

// A person's wall (decision 0115): posts, a bio and a cover, hosted and not
// end-to-end encrypted. Every signed-in account reads the bio and the cover; each
// post says who else reads it, and that is decided when it is read.

const tags = ["walls"];
const owner = z.object({ accountId: OpaqueId });
const NO_ACCOUNT = { 404: errorResponse("not_found: no such account the caller can see") };
const Binary = z.string().openapi({ type: "string", format: "binary" });

const WallProfile = z
  .object({
    accountId: OpaqueId,
    wallId: OpaqueId.nullable().openapi({
      description: "Null until the account's first post or cover",
    }),
    bio: z.string().nullable(),
    cover: OpaqueId.nullable().openapi({ description: "The cover's version, or null" }),
    coverFrames: Framing.nullable().openapi({ description: "How the cover is framed, or null" }),
    joinedMonth: z.string().openapi({ description: "`YYYY-MM`, the month of joining and no more" }),
  })
  .openapi("WallProfile");

export const getWallRoute = createRoute({
  method: "get",
  path: "/v1/accounts/{accountId}/wall",
  operationId: "getWall",
  tags,
  summary: "A person's wall: bio, cover and month of joining",
  security: ACCOUNT,
  request: { params: owner },
  responses: { 200: json("The wall", WallProfile), ...INVALID, ...AUTHED, ...NO_ACCOUNT },
});

export const wallPostsRoute = createRoute({
  method: "get",
  path: "/v1/accounts/{accountId}/wall/posts",
  operationId: "listWallPosts",
  tags,
  summary: "The wall posts the caller may read, newest first",
  security: ACCOUNT,
  request: { params: owner, query: z.object(page) },
  responses: { 200: json("A page", PostPage), ...INVALID, ...AUTHED, ...NO_ACCOUNT },
});

export const wallImagesRoute = createRoute({
  method: "get",
  path: "/v1/accounts/{accountId}/wall/images",
  operationId: "listWallImages",
  tags,
  summary: "The images of the wall posts the caller may read, newest first",
  security: ACCOUNT,
  request: {
    params: owner,
    query: z.object({
      cursor: Cursor.optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  },
  responses: { 200: COMMUNITY_IMAGE_PAGE, ...INVALID, ...AUTHED, ...NO_ACCOUNT },
});

const REFUSED = {
  403: errorResponse(
    "suspended: the account is suspended now, with `until` when it ends (decision 0115)",
  ),
};

export const createWallPostRoute = createRoute({
  method: "post",
  path: "/v1/wall/posts",
  operationId: "createWallPost",
  tags,
  summary: "Post on the caller's own wall",
  description: "As a post in a community, and not end-to-end encrypted either.",
  security: ACCOUNT,
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: z.object({ ...POST_FIELDS, audience: WallAudience.default("friends") }),
        },
      },
    },
  },
  responses: {
    200: json("Posted", Post),
    400: errorResponse(
      "invalid_request: neither a text nor an image, or a poll with no question, repeated options or an image; invalid_media: an image that is not the caller's upload to this wall, or is already in a post",
    ),
    ...REFUSED,
    ...AUTHED,
  },
});

export const uploadWallMediaRoute = createRoute({
  method: "post",
  path: "/v1/wall/media",
  operationId: "uploadWallMedia",
  tags,
  summary: "Upload an image for a post on the caller's own wall",
  security: ACCOUNT,
  request: { body: uploadSocialMediaRoute.request.body },
  responses: {
    200: uploadSocialMediaRoute.responses[200],
    400: errorResponse(
      "invalid_request: no Content-Length, or a body of another length; invalid_image: not an image the server can decode",
    ),
    413: errorResponse("too_large: more than the upload limit"),
    ...RATE_LIMITED,
    ...REFUSED,
    ...AUTHED,
  },
});

export const setPostAudienceRoute = createRoute({
  method: "patch",
  path: "/v1/posts/{postId}/audience",
  operationId: "setPostAudience",
  tags,
  summary: "Change who reads a wall post",
  description: "Only its author may. It applies from the next read.",
  security: ACCOUNT,
  request: {
    params: z.object({ postId: PostId }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ audience: WallAudience }) } },
    },
  },
  responses: {
    204: { description: "Changed" },
    ...INVALID,
    ...REFUSED,
    ...AUTHED,
    404: errorResponse("not_found: no such wall post by the caller"),
  },
});

export const setBioRoute = createRoute({
  method: "put",
  path: "/v1/me/bio",
  operationId: "setBio",
  tags,
  summary: "Set or clear the caller's bio",
  description: `At most ${MAX_BIO} characters and no line break; an empty text clears it.`,
  security: ACCOUNT,
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: z.object({ bio: z.string().max(MAX_BIO * 4) }) },
      },
    },
  },
  responses: { 204: { description: "Set" }, ...INVALID, ...REFUSED, ...AUTHED },
});

const CoverSet = z.object({ version: OpaqueId }).openapi("WallCoverSet");

export const putWallCoverRoute = createRoute({
  method: "put",
  path: "/v1/wall/cover",
  operationId: "setWallCover",
  tags,
  summary: "Set or replace the caller's cover (decision 0086)",
  description: `The body is an image of at most ${MAX_PHOTO_UPLOAD / 1024 / 1024} MB, with a Content-Length. It is not end-to-end encrypted.`,
  security: ACCOUNT,
  request: {
    body: { required: true, content: { "application/octet-stream": { schema: Binary } } },
  },
  responses: {
    200: json("Stored", CoverSet),
    400: errorResponse(
      "invalid_request: no Content-Length, or a body of another length; invalid_image: not an image the server can decode",
    ),
    413: errorResponse("too_large: more than the upload limit"),
    ...RATE_LIMITED,
    ...REFUSED,
    ...AUTHED,
  },
});

export const deleteWallCoverRoute = createRoute({
  method: "delete",
  path: "/v1/wall/cover",
  operationId: "removeWallCover",
  tags,
  summary: "Remove the caller's cover",
  security: ACCOUNT,
  responses: { 204: { description: "No cover, whether there was one or not" }, ...AUTHED },
});

export const patchWallCoverFramesRoute = createRoute({
  method: "patch",
  path: "/v1/wall/cover/frames",
  operationId: "frameWallCover",
  tags,
  summary: "Frame the caller's cover again (decision 0086)",
  security: ACCOUNT,
  request: {
    body: { required: true, content: { "application/json": { schema: Framing } } },
  },
  responses: {
    200: json("Stored", CoverSet),
    400: errorResponse(
      "invalid_request: a framing outside the image; invalid_image: a master that no longer decodes",
    ),
    404: errorResponse("not_found: no cover"),
    409: errorResponse("no_master: a cover stored before masters were kept"),
    ...RATE_LIMITED,
    ...REFUSED,
    ...AUTHED,
  },
});

export const getWallCoverSourceRoute = createRoute({
  method: "get",
  path: "/v1/wall/cover/source",
  operationId: "getWallCoverSource",
  tags,
  summary: "The caller's cover master, to frame it again (decision 0086)",
  security: ACCOUNT,
  responses: {
    200: { description: "The master", content: { "image/webp": { schema: Binary } } },
    404: errorResponse("not_found: no cover, or one stored before masters were kept"),
    ...AUTHED,
  },
});

export const getWallCoverRoute = createRoute({
  method: "get",
  path: "/v1/accounts/{accountId}/wall/cover",
  operationId: "getWallCover",
  tags,
  summary: "A person's cover, a WebP",
  security: ACCOUNT,
  request: {
    params: owner,
    query: z.object({ frame: z.enum(FRAME_NAMES.cover).optional() }),
  },
  responses: {
    200: { description: "The image", content: { "image/webp": { schema: Binary } } },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: no such cover the caller can see"),
  },
});

export const removeWallCommentRoute = createRoute({
  method: "post",
  path: "/v1/wall/comments/{commentId}/remove",
  operationId: "removeWallComment",
  tags,
  summary: "Remove a comment on the caller's own wall",
  description:
    "It is logged with the owner as actor, its text is kept for 90 days and its author is told. There is no review: it is their wall to keep.",
  security: ACCOUNT,
  request: {
    params: z.object({ commentId: CommentId }),
    body: {
      required: true,
      content: { "application/json": { schema: z.object({ reason }) } },
    },
  },
  responses: {
    204: { description: "Removed" },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: no such comment on the caller's wall"),
  },
});

const report = z.object({ reportId: OpaqueId });
const PLATFORM = {
  403: errorResponse("not_permitted: not a platform moderator"),
  404: errorResponse("not_found: no such open report on a wall post or comment"),
};

export const reportedTargetRoute = createRoute({
  method: "get",
  path: "/v1/moderation/reports/{reportId}/target",
  operationId: "readReportedWallContent",
  tags,
  summary: "What an open report on a wall says was written",
  description:
    "A platform moderator reads a wall post or comment only here, on an open report, and each read is a moderation log entry.",
  security: ACCOUNT,
  request: { params: report },
  responses: {
    200: json(
      "The text and images",
      z
        .object({ body: z.string().nullable(), media: z.array(MediaId) })
        .openapi("ReportedWallContent"),
    ),
    ...INVALID,
    ...AUTHED,
    ...PLATFORM,
  },
});

export const reportedMediaRoute = createRoute({
  method: "get",
  path: "/v1/moderation/reports/{reportId}/media/{mediaId}",
  operationId: "readReportedWallImage",
  tags,
  summary: "An image of what an open report on a wall names, as WebP",
  description: "As `readReportedWallContent`: on an open report, and each read is logged.",
  security: ACCOUNT,
  request: { params: report.extend({ mediaId: MediaId }) },
  responses: {
    200: { description: "The image", content: { "image/webp": { schema: Binary } } },
    ...INVALID,
    ...AUTHED,
    ...PLATFORM,
  },
});
