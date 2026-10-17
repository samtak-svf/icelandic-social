import type { OpenAPIHono } from "@hono/zod-openapi";
import { deleteCookie } from "hono/cookie";
import type { AppEnv } from "../app.ts";
import { endOtherSessionsRoute, endSessionRoute, listSessionsRoute } from "../api/sessions.ts";
import { inbox } from "../env/index.ts";
import { fail } from "../errors.ts";
import { log } from "../log.ts";
import { endSessions, SESSION_COOKIE, sessionCookie, sessionsOf } from "./sessions.ts";

// Where the account is signed in, and signing a client out (decision 0061).
// Any session of the account may end any other, from a phone or a browser.

export function sessionRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listSessionsRoute, async (c) => {
    const { accountId, sessionId } = c.var.session;
    const sessions = await sessionsOf(c.env, accountId);
    return c.json(
      { sessions: sessions.map((s) => ({ ...s, current: s.sessionId === sessionId })) },
      200,
    );
  });

  app.openapi(endSessionRoute, async (c) => {
    const { accountId, sessionId: current } = c.var.session;
    const { sessionId } = c.req.valid("param");
    const { ended, devices } = await endSessions(c.env, accountId, { only: sessionId });
    if (ended === 0) return fail(c, 404, "not_found");
    for (const deviceId of devices) await inbox(c.env, accountId).closeDevice(deviceId);
    if (sessionId === current) deleteCookie(c, SESSION_COOKIE, sessionCookie(0));
    log("session.ended", { accountId, sessionId, count: devices.length });
    return c.body(null, 204);
  });

  app.openapi(endOtherSessionsRoute, async (c) => {
    const { accountId, sessionId } = c.var.session;
    const { ended, devices } = await endSessions(c.env, accountId, { except: sessionId });
    for (const deviceId of devices) await inbox(c.env, accountId).closeDevice(deviceId);
    log("session.others_ended", { accountId, sessionId, count: ended });
    return c.json({ ended }, 200);
  });
}
