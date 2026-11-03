import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, SUSPENDED } from "./common.ts";
import { json } from "./social.ts";

// Direct transfers from an exporter (decision 0129): the consent a browser gives when an
// exporter sends the person here, and the person's list of what they allowed. The
// exporter's own endpoints (/oauth, /dtp) follow its protocol and are not in this
// contract. While no exporter is configured, every route but the list answers not_found.

const tags = ["transfers"];
const NOT_FOUND = errorResponse("not_found: no such request or grant, or transfers are off");

const Scope = z.enum(["social-posts", "media"]).openapi("TransferScope");

const TransferGrant = z
  .object({
    grantId: OpaqueId,
    clientName: z.string().openapi({ description: "The exporter, as the person reads it" }),
    scopes: z.array(Scope),
    createdAt: z.int().openapi({ description: "Milliseconds since the epoch" }),
    importId: OpaqueId.nullable().openapi({
      description:
        "The standing import its items come into, reviewed as any import; null before the first",
    }),
    posts: z.int(),
    held: z.int().openapi({ description: "Of those, how many wait to be opened" }),
    leftBehind: z.int().openapi({ description: "Items taken and not brought in, as videos" }),
    lastItemAt: z.int().nullable().openapi({ description: "Milliseconds since the epoch" }),
  })
  .openapi("TransferGrant");

const TransferList = z
  .object({
    available: z.boolean().openapi({ description: "Whether an exporter is configured here" }),
    grants: z.array(TransferGrant),
  })
  .openapi("TransferList");

const TransferRequest = z
  .object({ clientName: z.string(), scopes: z.array(Scope) })
  .openapi("TransferRequest");

const TransferRedirect = z
  .object({
    redirect: z.url().openapi({ description: "Where the browser goes back to the exporter" }),
  })
  .openapi("TransferRedirect");

const GrantParams = z.object({ grantId: OpaqueId });
const RequestParams = z.object({ requestId: OpaqueId });

export const listTransfersRoute = createRoute({
  method: "get",
  path: "/v1/transfers",
  operationId: "listTransfers",
  tags,
  summary: "The exporters the caller allowed to transfer in, newest first",
  security: ACCOUNT,
  responses: { 200: json("The grants still in force", TransferList), ...AUTHED },
});

export const revokeTransferRoute = createRoute({
  method: "delete",
  path: "/v1/transfers/{grantId}",
  operationId: "revokeTransfer",
  tags,
  summary: "Take a grant back: its tokens stop working, and what came in stays held",
  security: ACCOUNT,
  request: { params: GrantParams },
  responses: { 204: { description: "Revoked" }, 404: NOT_FOUND, ...INVALID, ...AUTHED },
});

export const getTransferRequestRoute = createRoute({
  method: "get",
  path: "/v1/transfer-requests/{requestId}",
  operationId: "getTransferRequest",
  tags,
  summary: "What an exporter asks to be allowed, for the consent screen",
  security: ACCOUNT,
  request: { params: RequestParams },
  responses: { 200: json("The request", TransferRequest), 404: NOT_FOUND, ...INVALID, ...AUTHED },
});

export const approveTransferRoute = createRoute({
  method: "post",
  path: "/v1/transfer-requests/{requestId}/approve",
  operationId: "approveTransferRequest",
  tags,
  summary: "Allow the exporter, and send the browser back with a one-time code",
  security: ACCOUNT,
  request: { params: RequestParams },
  responses: {
    200: json("Where to go", TransferRedirect),
    404: NOT_FOUND,
    ...SUSPENDED,
    ...INVALID,
    ...AUTHED,
  },
});

export const denyTransferRoute = createRoute({
  method: "post",
  path: "/v1/transfer-requests/{requestId}/deny",
  operationId: "denyTransferRequest",
  tags,
  summary: "Refuse the exporter, and send the browser back saying so",
  security: ACCOUNT,
  request: { params: RequestParams },
  responses: { 200: json("Where to go", TransferRedirect), 404: NOT_FOUND, ...INVALID, ...AUTHED },
});
