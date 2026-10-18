import type { OpenAPIHono } from "@hono/zod-openapi";
import { notificationsRoute, readNotificationsRoute } from "../../api/notifications.ts";
import type { AppEnv } from "../../app.ts";
import { markRead, notificationPage } from "./list.ts";

export function notificationRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(notificationsRoute, async (c) => {
    const { before, limit } = c.req.valid("query");
    const page = await notificationPage(
      c.env,
      c.var.session.accountId,
      before === undefined ? null : Number(before),
      limit,
    );
    return c.json(page, 200);
  });

  app.openapi(readNotificationsRoute, async (c) => {
    await markRead(c.env, c.var.session.accountId, c.req.valid("json").upTo);
    return c.body(null, 204);
  });
}
