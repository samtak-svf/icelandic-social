import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  checkImportConnectionRoute,
  createImportConnectionRoute,
  deleteImportConnectionRoute,
  listImportConnectionsRoute,
} from "../../api/import-connections.ts";
import type { AppEnv } from "../../http.ts";
import { notSuspended } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { askForCheck, createConnection, listConnections, removeConnection } from "./connections.ts";
import { limited } from "./routes.ts";
import { scrapeSettings } from "./scrape.ts";

// The routes of a connection to a public profile (decision 0120). Another person's
// connection answers not_found, as one that does not exist.

export function connectionRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(notSuspended(createImportConnectionRoute), async (c) => {
    const { accountId } = c.var.session;
    if (await limited(c, accountId)) return fail(c, 429, "rate_limited");
    const created = await createConnection(c.env, accountId, c.req.valid("json"));
    if (created === "unavailable") return fail(c, 503, "unavailable");
    if (created === "invalid_request") return fail(c, 400, "invalid_request");
    if (created === "conflict") return fail(c, 409, "conflict");
    log("imports.connection_started", { accountId });
    return c.json(created, 201);
  });

  app.openapi(listImportConnectionsRoute, async (c) =>
    c.json(
      {
        available: scrapeSettings(c.env) !== null,
        connections: await listConnections(c.env, c.var.session.accountId),
      },
      200,
    ),
  );

  app.openapi(notSuspended(checkImportConnectionRoute), async (c) => {
    const { accountId } = c.var.session;
    if (await limited(c, accountId)) return fail(c, 429, "rate_limited");
    const asked = await askForCheck(c.env, accountId, c.req.valid("param").importId);
    if (asked === "unavailable") return fail(c, 503, "unavailable");
    if (asked === "not_found") return fail(c, 404, "not_found");
    if (asked === "conflict") return fail(c, 409, "conflict");
    return c.json(asked, 202);
  });

  app.openapi(deleteImportConnectionRoute, async (c) => {
    const { accountId } = c.var.session;
    const removed = await removeConnection(c.env, accountId, c.req.valid("param").importId);
    if (removed !== "ok") return fail(c, 404, "not_found");
    log("imports.removed", { accountId });
    return c.body(null, 204);
  });
}
