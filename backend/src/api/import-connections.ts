import { createRoute, z } from "@hono/zod-openapi";
import {
  ACCOUNT,
  AUTHED,
  errorResponse,
  INVALID,
  OpaqueId,
  RATE_LIMITED,
  SUSPENDED,
} from "./common.ts";
import { WallAudience } from "./post-fields.ts";
import { json } from "./social.ts";

// A connection to a person's own public profile (decision 0120): they publish a
// one-time code there, a check finds it, and their posts come in and stay in step.
// Only its owner reaches a connection.

const tags = ["imports"];
const Params = z.object({ importId: OpaqueId });
const NOT_FOUND = errorResponse("not_found: no such connection of the caller's");
const UNAVAILABLE = { 503: errorResponse("unavailable: this feed is switched off here") };

const ImportConnection = z
  .object({
    importId: OpaqueId,
    profileUrl: z.string(),
    code: z.string().nullable().openapi({
      description: "What the person publishes on the profile; null once it has been found",
    }),
    state: z.enum(["unproven", "checking", "importing", "preview", "connected"]).openapi({
      description:
        "preview: the first collection waits to be chosen from, under the import's routes",
    }),
    outcome: z.enum(["not_found", "capped", "failed", "ok"]).nullable().openapi({
      description: "How the last run ended; not_found means the code was not on the profile",
    }),
    posts: z.int().openapi({ description: "Posts brought in so far" }),
    lastSyncAt: z.int().nullable().openapi({ description: "Milliseconds since the epoch" }),
  })
  .openapi("ImportConnection");

const CreateImportConnection = z
  .object({
    profileUrl: z.string().max(2048),
    audience: WallAudience.optional().openapi({
      description:
        "Who reads the posts; friends when left out, since nothing is public unless chosen",
    }),
  })
  .openapi("CreateImportConnection");

export const createImportConnectionRoute = createRoute({
  method: "post",
  path: "/v1/imports/connections",
  operationId: "createImportConnection",
  tags,
  summary: "Connect a public profile of the caller's; nothing comes in until the code is found",
  security: ACCOUNT,
  request: {
    body: { required: true, content: { "application/json": { schema: CreateImportConnection } } },
  },
  responses: {
    201: json("Publish the code on the profile, then ask for a check", ImportConnection),
    409: errorResponse("conflict: the caller has as many connections as one person may"),
    ...UNAVAILABLE,
    ...SUSPENDED,
    ...INVALID,
    ...RATE_LIMITED,
    ...AUTHED,
  },
});

export const listImportConnectionsRoute = createRoute({
  method: "get",
  path: "/v1/imports/connections",
  operationId: "listImportConnections",
  tags,
  summary: "The caller's connections",
  security: ACCOUNT,
  responses: {
    200: json(
      "The connections, oldest first",
      z
        .object({
          available: z.boolean().openapi({
            description: "Whether a new connection can be made here; false when switched off",
          }),
          connections: z.array(ImportConnection),
        })
        .openapi("ImportConnectionList"),
    ),
    ...AUTHED,
  },
});

export const checkImportConnectionRoute = createRoute({
  method: "post",
  path: "/v1/imports/connections/{importId}/check",
  operationId: "checkImportConnection",
  tags,
  summary: "Look for the code on the profile",
  security: ACCOUNT,
  request: { params: Params },
  responses: {
    202: json("The check has begun; watch the connection's state", ImportConnection),
    404: NOT_FOUND,
    409: errorResponse("conflict: already proven, a check is out, or too many checks"),
    ...UNAVAILABLE,
    ...SUSPENDED,
    ...INVALID,
    ...RATE_LIMITED,
    ...AUTHED,
  },
});

export const deleteImportConnectionRoute = createRoute({
  method: "delete",
  path: "/v1/imports/connections/{importId}",
  operationId: "deleteImportConnection",
  tags,
  summary: "Stop a connection and remove every post it brought in",
  security: ACCOUNT,
  request: { params: Params },
  responses: { 204: { description: "Removal has begun" }, 404: NOT_FOUND, ...INVALID, ...AUTHED },
});
