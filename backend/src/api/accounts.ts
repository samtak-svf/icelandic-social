import { createRoute, z } from "@hono/zod-openapi";
import {
  AUTHED,
  DEVICE_TOKEN,
  errorResponse,
  INVALID,
  OpaqueId,
  PhotoVersion,
  RATE_LIMITED,
} from "./common.ts";

// Other accounts' names (decisions 0022, 0034), the directory of people
// (decision 0036), block (decision 0024) and the profile photo (decision 0039).

const Profile = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable().openapi({
      description:
        "The name shown: the registry's once Kenni verified it, else the one the sign-in gave",
    }),
    verified: z.boolean(),
    photo: PhotoVersion,
  })
  .openapi("Profile");

const PeoplePage = z
  .object({
    people: z.array(Profile).openapi({ description: "Verified first, then by name" }),
    next: z
      .string()
      .nullable()
      .openapi({ description: "The cursor of the next page, null on the last" }),
  })
  .openapi("PeoplePage");

const BlockedAccount = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable(),
    verified: z.boolean(),
    blockedAt: z.int().openapi({ description: "Unix milliseconds" }),
  })
  .openapi("BlockedAccount");

const BlockList = z
  .object({ blocked: z.array(BlockedAccount).openapi({ description: "Newest first" }) })
  .openapi("BlockList");

const account = z.object({ accountId: OpaqueId });

export const getAccountRoute = createRoute({
  method: "get",
  path: "/v1/accounts/{accountId}",
  operationId: "getAccount",
  tags: ["accounts"],
  summary: "The name, mark and photo version of any account (decisions 0034, 0039)",
  security: DEVICE_TOKEN,
  request: { params: account },
  responses: {
    200: { description: "The account", content: { "application/json": { schema: Profile } } },
    ...INVALID,
    404: errorResponse("not_found: no such account"),
    ...AUTHED,
  },
});

export const listPeopleRoute = createRoute({
  method: "get",
  path: "/v1/people",
  operationId: "listPeople",
  tags: ["accounts"],
  summary: "Every other signed-in account, for the new-conversation picker (decision 0036)",
  description:
    "Accounts with a name and a device the server still serves, less the caller, those it " +
    "blocked and those that blocked it. `q` keeps the names it starts, or a word in which it " +
    "starts after a space or a hyphen (decision 0038), compared without case or the " +
    "Icelandic letters (ð as d, þ as th, æ as ae, ö as o, no accents).",
  security: DEVICE_TOKEN,
  request: {
    query: z.object({
      q: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .optional()
        .openapi({ description: "The start of a name or of a word in it" }),
      after: z.string().min(1).max(600).optional().openapi({ description: "From `next`" }),
      limit: z.coerce.number().int().min(1).max(50).default(30),
    }),
  },
  responses: {
    200: { description: "A page", content: { "application/json": { schema: PeoplePage } } },
    400: errorResponse("invalid_request: the query, or a cursor not from `next`"),
    ...AUTHED,
  },
});

export const listBlocksRoute = createRoute({
  method: "get",
  path: "/v1/blocks",
  operationId: "listBlocks",
  tags: ["blocks"],
  summary: "The accounts this account has blocked",
  security: DEVICE_TOKEN,
  responses: {
    200: { description: "The list", content: { "application/json": { schema: BlockList } } },
    ...AUTHED,
  },
});

export const blockRoute = createRoute({
  method: "put",
  path: "/v1/blocks/{accountId}",
  operationId: "blockAccount",
  tags: ["blocks"],
  summary: "Block an account: it can no longer claim this account's KeyPackages or add it",
  security: DEVICE_TOKEN,
  request: { params: account },
  responses: {
    204: { description: "Blocked; blocking again is no error" },
    400: errorResponse("invalid_request: the account is the caller's own"),
    404: errorResponse("not_found: no such account"),
    ...AUTHED,
  },
});

export const unblockRoute = createRoute({
  method: "delete",
  path: "/v1/blocks/{accountId}",
  operationId: "unblockAccount",
  tags: ["blocks"],
  summary: "Lift a block",
  security: DEVICE_TOKEN,
  request: { params: account },
  responses: {
    204: { description: "Not blocked, whether it was or not" },
    ...INVALID,
    ...AUTHED,
  },
});

/** The largest upload of a profile photo (decision 0039), before it is re-encoded. */
export const MAX_PHOTO_UPLOAD = 10 * 1024 * 1024;

const Binary = z.string().openapi({ type: "string", format: "binary" });

const PhotoSet = z
  .object({ photo: OpaqueId.openapi({ description: "The new photo's version" }) })
  .openapi("PhotoSet");

export const putPhotoRoute = createRoute({
  method: "put",
  path: "/v1/me/photo",
  operationId: "setPhoto",
  tags: ["accounts"],
  summary: "Set or replace this account's profile photo (decision 0039)",
  description:
    "The body is an image (JPEG, PNG, WebP, GIF or AVIF) of at most 10 MB, with a " +
    "Content-Length. The server re-encodes it to a 512 by 512 WebP without metadata and keeps " +
    "only that; the photo it replaces is gone. Every signed-in account sees it, less those " +
    "a block keeps it from. It is not end-to-end encrypted.",
  security: DEVICE_TOKEN,
  request: {
    body: { required: true, content: { "application/octet-stream": { schema: Binary } } },
  },
  responses: {
    200: { description: "Stored", content: { "application/json": { schema: PhotoSet } } },
    400: errorResponse(
      "invalid_request: no Content-Length, or a body of another length; " +
        "invalid_image: not an image the server can decode",
    ),
    413: errorResponse("too_large: more than 10 MB"),
    ...RATE_LIMITED,
    ...AUTHED,
  },
});

export const deletePhotoRoute = createRoute({
  method: "delete",
  path: "/v1/me/photo",
  operationId: "removePhoto",
  tags: ["accounts"],
  summary: "Remove this account's profile photo (decision 0039)",
  security: DEVICE_TOKEN,
  responses: {
    204: { description: "No photo, whether there was one or not" },
    ...AUTHED,
  },
});

export const getPhotoRoute = createRoute({
  method: "get",
  path: "/v1/accounts/{accountId}/photo",
  operationId: "getPhoto",
  tags: ["accounts"],
  summary: "An account's profile photo, a 512 by 512 WebP (decision 0039)",
  security: DEVICE_TOKEN,
  request: { params: account },
  responses: {
    200: { description: "The photo", content: { "image/webp": { schema: Binary } } },
    ...INVALID,
    404: errorResponse(
      "not_found: no such account, no photo, or a block between the two accounts withholds it",
    ),
    ...AUTHED,
  },
});
