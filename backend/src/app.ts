import { OpenAPIHono } from "@hono/zod-openapi";
import { createMiddleware } from "hono/factory";
import { type Device, deviceForToken } from "./accounts.ts";
import { createConversationRoute, getWelcomeRoute } from "./api/conversations.ts";
import { deleteAccountRoute, registerDeviceRoute, revokeDeviceRoute } from "./api/devices.ts";
import { WsFrame } from "./api/frames.ts";
import { healthRoute } from "./api/health.ts";
import { claimKeyPackagesRoute, uploadKeyPackagesRoute } from "./api/key-packages.ts";
import { listMessagesRoute, sendMessageRoute } from "./api/messages.ts";
import { socketRoute } from "./api/socket.ts";
import { toBase64 } from "./bytes.ts";
import { checkSend } from "./conversations.ts";
import { conversation, minClientVersions } from "./env/index.ts";

/** OpenAPI 3.1 document metadata; the routes and schemas come from src/api/. */
export const DOCUMENT_INFO = {
  openapi: "3.1.0",
  info: { title: "spjall-api", version: "0.1.0" },
} as const;

const BEARER = /^Bearer ([A-Za-z0-9_-]{16,256})$/;

/** What every handler sees: the bindings, and the device a token resolved to. */
type AppEnv = { Bindings: Env; Variables: { device: Device } };

/**
 * Every /v1 route but device registration needs a device token (decision
 * 0014): its hash must name an active device in D1, which the handlers then
 * act as.
 */
const deviceToken = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method === "POST" && c.req.path === "/v1/devices") return next();
  const token = BEARER.exec(c.req.header("authorization") ?? "")?.[1];
  const device = token ? await deviceForToken(c.env, token) : null;
  if (!device) return c.json({ error: "unauthorized" }, 401);
  c.set("device", device);
  return next();
});

const notImplemented = { error: "not_implemented" } as const;

export function createApp() {
  const app = new OpenAPIHono<AppEnv>({
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

  // Decisions 0014 and 0017: in the contract now, built in phase 1. Routes are
  // registered in the order api/openapi.json lists them.
  app.openapi(registerDeviceRoute, (c) => c.json(notImplemented, 501));
  app.openapi(revokeDeviceRoute, (c) => c.json(notImplemented, 501));
  app.openapi(deleteAccountRoute, (c) => c.json(notImplemented, 501));

  // Conversations (decisions 0015, 0017). The Worker reads the framing; the
  // Conversation DO decides membership, order and the epoch.
  app.openapi(sendMessageRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const checked = checkSend(c.var.device.accountId, conversationId, c.req.valid("json"));
    if ("error" in checked) return c.json({ error: checked.error }, 400);
    const result = await conversation(c.env, conversationId).send(checked.ok);
    if ("ok" in result) return c.json(result.ok, 200);
    switch (result.error) {
      case "not_found":
        return c.json({ error: result.error }, 404);
      case "not_a_member":
        return c.json({ error: result.error }, 403);
      case "epoch_conflict":
        return c.json({ error: result.error }, 409);
      default:
        return c.json({ error: "invalid_request" }, 400);
    }
  });

  app.openapi(listMessagesRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const { after, limit = 100 } = c.req.valid("query");
    const result = await conversation(c.env, conversationId).list(
      c.var.device.accountId,
      after,
      limit,
    );
    if ("error" in result) {
      return result.error === "not_found"
        ? c.json({ error: result.error }, 404)
        : c.json({ error: "not_a_member" }, 403);
    }
    const messages = result.ok.messages.map((m) => ({
      seq: m.seq,
      ciphertext: toBase64(m.ciphertext),
    }));
    return c.json({ messages, more: result.ok.more }, 200);
  });

  app.openapi(createConversationRoute, async (c) => {
    const { conversationId } = c.req.valid("json");
    const result = await conversation(c.env, conversationId).create(
      c.var.device.accountId,
      conversationId,
    );
    return "ok" in result
      ? c.json({ conversationId }, 200)
      : c.json({ error: "conversation_exists" }, 409);
  });

  app.openapi(getWelcomeRoute, async (c) => {
    const { conversationId } = c.req.valid("param");
    const result = await conversation(c.env, conversationId).welcome(c.var.device.accountId);
    if ("error" in result) {
      return result.error === "not_a_member"
        ? c.json({ error: result.error }, 403)
        : c.json({ error: "not_found" }, 404);
    }
    return c.json({ seq: result.ok.seq, welcome: toBase64(result.ok.welcome) }, 200);
  });

  app.openapi(uploadKeyPackagesRoute, (c) => c.json(notImplemented, 501));
  app.openapi(claimKeyPackagesRoute, (c) => c.json(notImplemented, 501));
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
