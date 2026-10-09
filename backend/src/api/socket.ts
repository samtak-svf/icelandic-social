import { createRoute } from "@hono/zod-openapi";
import { AUTHED, DEVICE_TOKEN, errorResponse } from "./common.ts";

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
  security: DEVICE_TOKEN,
  "x-ws-frames": { $ref: "#/components/schemas/WsFrame" },
  responses: {
    101: { description: "Switching to the WebSocket" },
    ...AUTHED,
    426: errorResponse(
      "upgrade_required: not a WebSocket upgrade; client_too_old: below the floor (decision 0030)",
    ),
  },
});
