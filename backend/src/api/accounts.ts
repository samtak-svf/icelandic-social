import { createRoute, z } from "@hono/zod-openapi";
import { AUTHED, DEVICE_TOKEN, errorResponse, INVALID, OpaqueId } from "./common.ts";

// Other accounts' names (decisions 0022, 0034), the directory of people
// (decision 0036) and block (decision 0024).

const Profile = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable().openapi({
      description:
        "The name shown: the registry's once Kenni verified it, else the one the sign-in gave",
    }),
    verified: z.boolean(),
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
  summary: "The name and mark of any account (decision 0034)",
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
    "blocked and those that blocked it. `q` keeps the names that contain it, compared " +
    "without case or the Icelandic letters (ð as d, þ as th, æ as ae, ö as o, no accents).",
  security: DEVICE_TOKEN,
  request: {
    query: z.object({
      q: z.string().trim().min(1).max(100).optional().openapi({ description: "Part of a name" }),
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
