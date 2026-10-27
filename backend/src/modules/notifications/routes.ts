import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  communityLevelRoute,
  deleteNotificationRoute,
  notificationSettingsRoute,
  notificationsRoute,
  putNotificationSettingsRoute,
  readNotificationsRoute,
  seenNotificationsRoute,
} from "../../api/notifications.ts";
import type { AppEnv } from "../../http.ts";
import { fail } from "../../shared/errors.ts";
import { canRead, standing } from "../communities/index.ts";
import { markRead, markSeen, notificationPage, removeNotification, setRead } from "./list.ts";
import { setCommunityLevel, setKinds, settingsOf } from "./settings.ts";

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

  app.openapi(notificationSettingsRoute, async (c) => {
    return c.json(await settingsOf(c.env, c.var.session.accountId), 200);
  });

  app.openapi(putNotificationSettingsRoute, async (c) => {
    await setKinds(c.env, c.var.session.accountId, c.req.valid("json").kinds);
    return c.body(null, 204);
  });

  app.openapi(communityLevelRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const found = await standing(c.env, accountId, communityId);
    if (!found || !canRead(found)) return fail(c, 404, "not_found");
    await setCommunityLevel(c.env, accountId, communityId, c.req.valid("json").level);
    return c.body(null, 204);
  });
}
