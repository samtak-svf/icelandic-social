import type { OpenAPIHono } from "@hono/zod-openapi";
import {
  approveTransferRoute,
  denyTransferRoute,
  getTransferRequestRoute,
  listTransfersRoute,
  revokeTransferRoute,
} from "../../api/transfers.ts";
import type { AppEnv } from "../../http.ts";
import { notSuspended } from "../../identity/index.ts";
import { fail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { transferSummary, type TransferSummary } from "../imports/index.ts";
import { clientOf, type Scope, type TransferClient } from "./client.ts";
import { approve, deny, type GrantRow, grantsOf, requestOf, revokeGrant } from "./grants.ts";

// The person's side of a direct transfer (decision 0129): consenting in the browser the
// exporter sent them to, and seeing and taking back what they allowed. Another person's
// request or grant answers not_found, as one that does not exist.

const scopesOf = (scope: string) => scope.split(" ") as Scope[];

/** A grant as the person sees it: whose, since when, and what came of it. */
function grantView(
  grant: GrantRow,
  client: TransferClient | null,
  summary: TransferSummary | null,
) {
  return {
    grantId: grant.grantId,
    clientName: client?.id === grant.clientId ? client.name : grant.clientId,
    scopes: scopesOf(grant.scope),
    createdAt: grant.createdAt,
    importId: summary?.importId ?? null,
    posts: summary?.posts ?? 0,
    held: summary?.held ?? 0,
    leftBehind: summary?.leftBehind ?? 0,
    lastItemAt: summary?.lastItemAt ?? null,
  };
}

export function transferRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(listTransfersRoute, async (c) => {
    const { accountId } = c.var.session;
    const client = clientOf(c.env);
    const summaries = new Map<string, TransferSummary | null>();
    const grants = [];
    for (const grant of await grantsOf(c.env, accountId)) {
      if (!summaries.has(grant.clientId)) {
        summaries.set(grant.clientId, await transferSummary(c.env, accountId, grant.clientId));
      }
      grants.push(grantView(grant, client, summaries.get(grant.clientId) ?? null));
    }
    return c.json({ available: client !== null, grants }, 200);
  });

  app.openapi(revokeTransferRoute, async (c) => {
    const { accountId } = c.var.session;
    if (!(await revokeGrant(c.env, accountId, c.req.valid("param").grantId)))
      return fail(c, 404, "not_found");
    log("transfers.revoked", { accountId });
    return c.body(null, 204);
  });

  app.openapi(getTransferRequestRoute, async (c) => {
    const client = clientOf(c.env);
    const request = client && (await requestOf(c.env, c.req.valid("param").requestId));
    if (!client || !request || request.clientId !== client.id) return fail(c, 404, "not_found");
    return c.json({ clientName: client.name, scopes: scopesOf(request.scope) }, 200);
  });

  app.openapi(notSuspended(approveTransferRoute), async (c) => {
    const { accountId } = c.var.session;
    const client = clientOf(c.env);
    const request = client && (await requestOf(c.env, c.req.valid("param").requestId));
    if (!client || !request || request.clientId !== client.id) return fail(c, 404, "not_found");
    const redirect = await approve(c.env, accountId, request);
    log("transfers.granted", { accountId });
    return c.json({ redirect }, 200);
  });

  app.openapi(denyTransferRoute, async (c) => {
    const client = clientOf(c.env);
    const request = client && (await requestOf(c.env, c.req.valid("param").requestId));
    if (!client || !request || request.clientId !== client.id) return fail(c, 404, "not_found");
    return c.json({ redirect: await deny(c.env, request) }, 200);
  });
}
