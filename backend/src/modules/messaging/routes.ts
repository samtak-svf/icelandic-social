import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../app.ts";
import { groupPhotoRoutes } from "./group-photo-routes.ts";
import { muteRoutes } from "./mutes.ts";

/** The routes the messaging module owns beside the core ones in app.ts: mutes and group photos. */
export function mediaRoutes(app: OpenAPIHono<AppEnv>): void {
  muteRoutes(app);
  groupPhotoRoutes(app);
}
