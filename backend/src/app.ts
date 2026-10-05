import { OpenAPIHono } from "@hono/zod-openapi";
import { healthRoute } from "./api/health.ts";
import { WsFrame } from "./api/frames.ts";
import { minClientVersions } from "./env/index.ts";

/** OpenAPI 3.1 document metadata; the routes and schemas come from src/api/. */
export const DOCUMENT_INFO = {
  openapi: "3.1.0",
  info: { title: "spjall-api", version: "0.1.0" },
} as const;

export function createApp() {
  const app = new OpenAPIHono<{ Bindings: Env }>();

  app.openapi(healthRoute, (c) =>
    c.json({ status: "ok" as const, minClientVersion: minClientVersions(c.env) }, 200),
  );

  // The WS frames are not a route, so they are registered as a component for
  // the generators (decision 0005).
  app.openAPIRegistry.register("WsFrame", WsFrame);

  return app;
}
