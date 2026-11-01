import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  createImportPageRoute,
  deleteImportPageRoute,
  listImportPagesRoute,
} from "../../api/import-pages.ts";
import type { AppEnv } from "../../http.ts";
import { notSuspended } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { overLimit, rateLimited } from "../../shared/rate-limit.ts";
import { connectPage, listPages, removePage } from "./pages.ts";

// The routes of a page connection (decision 0120). Another person's connection answers
// not_found, as one that does not exist.

export function pageRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listImportPagesRoute, async (c) =>
    c.json(await listPages(c.env, c.var.session.accountId), 200),
  );

  app.openapi(notSuspended(createImportPageRoute), async (c) => {
    const { accountId } = c.var.session;
    if (await overLimit(c, "photos", accountId)) return rateLimited(c);
    const connected = await connectPage(c.env, accountId, c.req.valid("json"));
    if (connected === "unavailable") return fail(c, 503, "unavailable");
    if (connected === "not_found") return fail(c, 404, "not_found");
    if (connected === "conflict") return fail(c, 409, "conflict");
    log("imports.page_connected", { accountId });
    return c.json(connected, 201);
  });

  app.openapi(deleteImportPageRoute, async (c) => {
    const { accountId } = c.var.session;
    const removed = await removePage(c.env, accountId, c.req.valid("param").importId);
    if (removed !== "ok") return fail(c, 404, "not_found");
    log("imports.removed", { accountId });
    return c.body(null, 204);
  });
}
