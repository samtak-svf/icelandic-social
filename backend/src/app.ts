import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { deleteAccountRoute, registerDeviceRoute, revokeDeviceRoute } from "./api/devices.ts";
import { WsFrame } from "./api/frames.ts";
import { healthRoute } from "./api/health.ts";
import { listMessagesRoute, sendMessageRoute } from "./api/messages.ts";
import { socketRoute } from "./api/socket.ts";
import { minClientVersions } from "./env/index.ts";

/** OpenAPI 3.1 document metadata; the routes and schemas come from src/api/. */
export const DOCUMENT_INFO = {
  openapi: "3.1.0",
  info: { title: "spjall-api", version: "0.1.0" },
} as const;

const BEARER = /^Bearer [A-Za-z0-9_-]{16,256}$/;

/**
 * Every /v1 route but device registration needs a device token (decision
 * 0014). Phase 0 checks its shape only; phase 1 looks its hash up in D1.
 */
const deviceToken = createMiddleware(async (c, next) => {
  if (c.req.method === "POST" && c.req.path === "/v1/devices") return next();
  if (!BEARER.test(c.req.header("authorization") ?? "")) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

const notImplemented = { error: "not_implemented" } as const;

export function createApp() {
  const app = new OpenAPIHono<{ Bindings: Env }>({
    defaultHook: (result, c) => {
      if (!result.success) return c.json({ error: "invalid_request" }, 400);
    },
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "deviceToken", {
    type: "http",
    scheme: "bearer",
    description: "The device token from registerDevice (decision 0014)",
  });
  app.use("/v1/*", deviceToken);

  app.openapi(healthRoute, (c) =>
    c.json({ status: "ok" as const, minClientVersion: minClientVersions(c.env) }, 200),
  );

  // Decisions 0014 and 0015: in the contract now, built in phase 1.
  app.openapi(registerDeviceRoute, (c) => c.json(notImplemented, 501));
  app.openapi(revokeDeviceRoute, (c) => c.json(notImplemented, 501));
  app.openapi(deleteAccountRoute, (c) => c.json(notImplemented, 501));
  app.openapi(sendMessageRoute, (c) => c.json(notImplemented, 501));
  app.openapi(listMessagesRoute, (c) => c.json(notImplemented, 501));
  app.openapi(socketRoute, (c) =>
    c.req.header("upgrade")?.toLowerCase() === "websocket"
      ? c.json(notImplemented, 501)
      : c.json({ error: "upgrade_required" }, 426),
  );

  // The frames are not a route body, so they are registered as a component
  // for the generators (decision 0005); /v1/ws points at it.
  app.openAPIRegistry.register("WsFrame", WsFrame);

  return app;
}
