import { createRoute } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse } from "./common.ts";

// The WebSocket (decision 0015). Its frames are the WsFrame union, which the
// generators read from components; `x-ws-frames` ties it to this route.

/** The headers the Worker sets on a socket it has authenticated; a client's are replaced. */
export const SOCKET_ACCOUNT = "x-spjall-account";
export const SOCKET_DEVICE = "x-spjall-device";

export const socketRoute = createRoute({
  method: "get",
  path: "/v1/ws",
  operationId: "openSocket",
  tags: ["socket"],
  summary: "Upgrade to the WebSocket that carries WsFrame",
  security: ACCOUNT,
  "x-ws-frames": { $ref: "#/components/schemas/WsFrame" },
  responses: {
    101: { description: "Switching to the WebSocket" },
    ...AUTHED,
    403: errorResponse(
      "forbidden_origin: a session cookie opens the socket only from the web host's own origin (decision 0081); no_linked_device: the session has no active linked device",
    ),
    426: errorResponse(
      "upgrade_required: not a WebSocket upgrade; client_too_old: below the floor (decision 0030)",
    ),
  },
});
