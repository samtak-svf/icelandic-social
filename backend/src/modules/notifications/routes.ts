import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  deleteNotificationRoute,
  notificationsRoute,
  readNotificationsRoute,
  seenNotificationsRoute,
} from "../../api/notifications.ts";
import type { AppEnv } from "../../http.ts";
import { fail } from "../../shared/errors.ts";
import { markRead, markSeen, notificationPage, removeNotification, setRead } from "./list.ts";

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
    const { accountId } = c.var.session;
    const body = c.req.valid("json");
    if (body.upTo !== undefined) {
      await markRead(c.env, accountId, body.upTo);
    } else if (!(await setRead(c.env, accountId, body.notificationId!, body.read!))) {
      return fail(c, 404, "not_found");
    }
    return c.body(null, 204);
  });

  app.openapi(seenNotificationsRoute, async (c) => {
    await markSeen(c.env, c.var.session.accountId, c.req.valid("json").upTo);
    return c.body(null, 204);
  });

  app.openapi(deleteNotificationRoute, async (c) => {
    const { notificationId } = c.req.valid("param");
    if (!(await removeNotification(c.env, c.var.session.accountId, notificationId))) {
      return fail(c, 404, "not_found");
    }
    return c.body(null, 204);
  });
}
