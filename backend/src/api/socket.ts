import { createRoute } from "@hono/zod-openapi";
import { AUTHED, DEVICE_TOKEN, errorResponse } from "./common.ts";

// The WebSocket (decision 0015). Its frames are the WsFrame union, which the
// generators read from components; `x-ws-frames` ties it to this route.

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
    426: errorResponse("upgrade_required: not a WebSocket upgrade"),
    ...AUTHED,
  },
});
