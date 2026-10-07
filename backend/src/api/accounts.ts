import { createRoute, z } from "@hono/zod-openapi";
import { AUTHED, DEVICE_TOKEN, errorResponse, INVALID, OpaqueId } from "./common.ts";

// Other accounts' names (decision 0022) and block (decision 0024).

const Profile = z
  .object({
    accountId: OpaqueId,
    name: z.string().nullable().openapi({ description: "The registry name, if Kenni gave one" }),
    verified: z.boolean(),
  })
  .openapi("Profile");

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
  summary: "The name and mark of an account this one shares a conversation with",
  security: DEVICE_TOKEN,
  request: { params: account },
  responses: {
    200: { description: "The account", content: { "application/json": { schema: Profile } } },
    ...INVALID,
    404: errorResponse(
      "not_found: no such account, or none this account shares a conversation with",
    ),
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
