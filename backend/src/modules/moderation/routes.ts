import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  closeReportRoute,
  communityLogRoute,
  communityReportsRoute,
  moderateRoute,
  platformLogRoute,
  platformReportsRoute,
  reportRoute,
} from "../../api/moderation.ts";
import { closePollRoute } from "../../api/polls.ts";
import { pinPostRoute, unpinPostRoute } from "../../api/social-hub.ts";
import type { AppEnv } from "../../http.ts";
import { db } from "../../env/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { moderates, standing } from "../communities/index.ts";
import { act, actor } from "./actions.ts";
import { anonymousRoutes } from "./anonymous.ts";
import { entry, logPage } from "./log.ts";
import { closePoll } from "./polls.ts";
import { setPostPin } from "./pins.ts";
import { closing, fileReport, isPlatformModerator, openReport, reportPage } from "./reports.ts";

// The routes of moderation (decisions 0063, 0066). A log line carries ids and
// counts, never a report's note or a reason (0008).

export function moderationRoutes(app: OpenAPIHono<AppEnv>): void {
  anonymousRoutes(app);

  for (const [route, on] of [
    [pinPostRoute, true],
    [unpinPostRoute, false],
  ] as const) {
    app.openapi(route, async (c) => {
      const { communityId, postId } = c.req.valid("param");
      const refused = await setPostPin(c.env, c.var.session.accountId, communityId, postId, on);
      if (refused) {
        return fail(
          c,
          refused === "not_found" ? 404 : refused === "pin_limit" ? 409 : 403,
          refused,
        );
      }
      return c.body(null, 204);
    });
  }

  app.openapi(closePollRoute, async (c) => {
    const { accountId } = c.var.session;
    const closed = await closePoll(c.env, accountId, c.req.valid("param").postId);
    if (closed === "not_permitted") return fail(c, 403, closed);
    return closed === "not_found" ? fail(c, 404, closed) : c.json(closed, 200);
  });

  app.openapi(reportRoute, async (c) => {
    const { accountId } = c.var.session;
    const input = c.req.valid("json");
    if (!(await fileReport(c.env, accountId, input))) return fail(c, 404, "not_found");
    log("report.filed", { accountId, code: input.target.kind });
    return c.body(null, 204);
  });

  app.openapi(communityReportsRoute, async (c) => {
    const { communityId } = c.req.valid("param");
    const found = await actor(c.env, c.var.session.accountId, communityId, { deleted: true });
    if (found === "not_found") return fail(c, 404, "not_found");
    if (found === "not_permitted") return fail(c, 403, "not_permitted");
    return c.json(await reportPage(c.env, communityId, c.req.valid("query")), 200);
  });

  app.openapi(platformReportsRoute, async (c) => {
    if (!(await isPlatformModerator(c.env, c.var.session.accountId))) {
      return fail(c, 403, "not_permitted");
    }
    return c.json(await reportPage(c.env, null, c.req.valid("query")), 200);
  });

  app.openapi(closeReportRoute, async (c) => {
    const { accountId } = c.var.session;
    const report = await openReport(c.env, c.req.valid("param").reportId);
    if (!report) return fail(c, 404, "not_found");
    const asPlatform = await isPlatformModerator(c.env, accountId);
    const place = report.communityId && (await standing(c.env, accountId, report.communityId));
    const asModerator = !report.toPlatform && !!place && moderates(place);
    if (!asModerator && !asPlatform) {
      // Only a moderator learns that a report it may not close is Samtak's.
      return place && moderates(place) ? fail(c, 403, "not_permitted") : fail(c, 404, "not_found");
    }
    const { resolution } = c.req.valid("json");
    await db(c.env).batch([
      closing(c.env, report.reportId, accountId, "dismissed", resolution),
      entry(c.env, {
        communityId: report.communityId,
        actorId: accountId,
        asPlatform: !asModerator,
        action: "close_report",
        targetKind: "report",
        targetId: report.reportId,
        targetAccount: null,
        reason: resolution,
      }),
    ]);
    log("report.closed", { accountId });
    return c.body(null, 204);
  });

  app.openapi(moderateRoute, async (c) => {
    const { accountId } = c.var.session;
    const { communityId } = c.req.valid("param");
    const done = await act(c.env, accountId, communityId, c.req.valid("json"));
    if (done === "invalid_request") return fail(c, 400, "invalid_request");
    if (done === "not_permitted") return fail(c, 403, "not_permitted");
    if (done === "not_found") return fail(c, 404, "not_found");
    log("moderation.acted", { accountId, communityId, code: c.req.valid("json").action });
    return c.body(null, 204);
  });

  app.openapi(communityLogRoute, async (c) => {
    const { communityId } = c.req.valid("param");
    const found = await actor(c.env, c.var.session.accountId, communityId, { deleted: true });
    if (found === "not_found") return fail(c, 404, "not_found");
    if (found === "not_permitted") return fail(c, 403, "not_permitted");
    const { before, limit } = c.req.valid("query");
    return c.json(await logPage(c.env, communityId, before, limit), 200);
  });

  app.openapi(platformLogRoute, async (c) => {
    if (!(await isPlatformModerator(c.env, c.var.session.accountId))) {
      return fail(c, 403, "not_permitted");
    }
    const { before, limit } = c.req.valid("query");
    return c.json(await logPage(c.env, null, before, limit), 200);
  });
}
