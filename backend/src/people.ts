import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  blockRoute,
  getAccountRoute,
  listBlocksRoute,
  listPeopleRoute,
  unblockRoute,
} from "./api/accounts.ts";
import type { AppEnv } from "./app.ts";
import { block, blockList, unblock } from "./blocks.ts";
import { fail } from "./errors.ts";
import { log } from "./log.ts";
import { decodeDirectoryCursor, directory, profile } from "./profiles.ts";

// The routes about other accounts: a name (decisions 0022, 0034), the
// directory of people (0036) and block (0024). Log lines carry ids only (0008).

export function accountRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(getAccountRoute, async (c) => {
    const found = await profile(c.env, c.req.valid("param").accountId);
    return found ? c.json(found, 200) : fail(c, 404, "not_found");
  });

  // The directory (decision 0036). The query is a name: it is never logged (0008).
  app.openapi(listPeopleRoute, async (c) => {
    const { q, after, limit } = c.req.valid("query");
    const cursor = after === undefined ? undefined : decodeDirectoryCursor(after);
    if (cursor === null) return fail(c, 400, "invalid_request");
    const found = await directory(c.env, c.var.device.accountId, {
      query: q,
      after: cursor,
      limit,
    });
    return c.json({ people: found.items, next: found.next }, 200);
  });

  app.openapi(listBlocksRoute, async (c) =>
    c.json({ blocked: await blockList(c.env, c.var.device.accountId) }, 200),
  );

  app.openapi(blockRoute, async (c) => {
    const { accountId } = c.var.device;
    const target = c.req.valid("param").accountId;
    if (target === accountId) return fail(c, 400, "invalid_request");
    if (!(await block(c.env, accountId, target))) return fail(c, 404, "not_found");
    log("account.blocked", { accountId });
    return c.body(null, 204);
  });

  app.openapi(unblockRoute, async (c) => {
    const { accountId } = c.var.device;
    await unblock(c.env, accountId, c.req.valid("param").accountId);
    log("account.unblocked", { accountId });
    return c.body(null, 204);
  });
}
