import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId } from "./common.ts";

// Sessions (decision 0061): where the account is signed in, and ending one.
// Ending a session, revoking a device and deleting the account are three
// actions, and none implies a broader one.

const SessionInfo = z
  .object({
    sessionId: OpaqueId,
    kind: z.enum(["web", "android", "ios"]).openapi({ description: "The client it is on" }),
    browser: z.string().nullable().openapi({
      description: "A browser's product name, such as Firefox; null for an app or one not known",
    }),
    os: z.string().nullable().openapi({
      description: "A browser's system, such as Linux; null for an app or one not known",
    }),
    deviceId: OpaqueId.nullable().openapi({
      description: "The device a phone's session enrolled; null for a browser",
    }),
    createdAt: z.int().openapi({ description: "Signed in, in milliseconds since the epoch" }),
    lastSeenAt: z.int().openapi({
      description:
        "A browser's last use, to the day; a phone's sign-in. Milliseconds since the epoch",
    }),
    expiresAt: z.int().nullable().openapi({
      description: "When a browser's session ends unless used; null for a phone's",
    }),
    current: z.boolean().openapi({ description: "The session that asked" }),
  })
  .openapi("SessionInfo");

export const listSessionsRoute = createRoute({
  method: "get",
  path: "/v1/me/sessions",
  operationId: "listSessions",
  tags: ["sessions"],
  summary: "Every session of this account, newest first",
  security: ACCOUNT,
  responses: {
    200: {
      description: "The sessions",
      content: {
        "application/json": { schema: z.object({ sessions: z.array(SessionInfo) }) },
      },
    },
    ...AUTHED,
  },
});

export const endOtherSessionsRoute = createRoute({
  method: "post",
  path: "/v1/me/sessions/end-others",
  operationId: "endOtherSessions",
  tags: ["sessions"],
  summary: "End every session of this account but the one that asks",
  description:
    "Each is ended as `endSession` ends one: the devices they enrolled are revoked with them.",
  security: ACCOUNT,
  responses: {
    200: {
      description: "How many sessions were ended",
      content: { "application/json": { schema: z.object({ ended: z.int() }) } },
    },
    ...AUTHED,
  },
});

export const endSessionRoute = createRoute({
  method: "delete",
  path: "/v1/sessions/{sessionId}",
  operationId: "endSession",
  tags: ["sessions"],
  summary: "End a session of this account: that client is signed out",
  description:
    "It is refused at once. The device it enrolled is revoked with it, as `revokeDevice` does, so no device outlives the sign-in that made it. Ending the session that asks is signing out; a browser's cookie is then cleared.",
  security: ACCOUNT,
  request: { params: z.object({ sessionId: OpaqueId }) },
  responses: {
    204: { description: "The session is ended" },
    ...INVALID,
    ...AUTHED,
    404: errorResponse("not_found: this account has no such session"),
  },
});
