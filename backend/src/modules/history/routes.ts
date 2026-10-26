import type { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import {
  completeHistoryTransferRoute,
  createHistoryTransferRoute,
  deleteHistoryRoute,
  getHistoryRoute,
  putHistoryPartRoute,
} from "../../api/history.ts";
import type { AppEnv } from "../../http.ts";
import { fail } from "../../errors.ts";
import { log } from "../../log.ts";
import {
  completeTransfer,
  createTransfer,
  deleteTransfer,
  getTransfer,
  putPart,
} from "./transfers.ts";

// History from a sibling device (decision 0064, #300). Log lines carry ids
// and sizes only (decision 0008); the link id is a capability, so not even that.

const STATUS = {
  not_found: 404,
  not_this_device: 403,
  conflict: 409,
  incomplete: 409,
  too_large: 413,
  expired: 410,
  invalid_request: 400,
} as const;

type Code = keyof typeof STATUS;

/** `fail` per code: a union of codes gives a union of responses, as each route declares them. */
type Refusal<K extends Code> = K extends Code ? ReturnType<typeof fail<(typeof STATUS)[K]>> : never;

function refusal<K extends Code>(c: Context<AppEnv>, code: K): Refusal<K> {
  return fail(c, STATUS[code], code) as Refusal<K>;
}

export function historyRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(createHistoryTransferRoute, async (c) => {
    const { linkId } = c.req.valid("param");
    const { size } = c.req.valid("json");
    const created = await createTransfer(c.env, c.var.device, linkId, size);
    if ("error" in created) return refusal(c, created.error);
    log("history.started", { deviceId: c.var.device.deviceId, size });
    return c.json(created.ok, 201);
  });

  app.openapi(putHistoryPartRoute, async (c) => {
    const { linkId, part } = c.req.valid("param");
    const body = c.req.raw.body;
    // A refusal cancels the body, so the client stops sending it.
    const refuse = async <T>(answer: T) => (await body?.cancel(), answer);
    const length = Number(c.req.header("content-length") ?? Number.NaN);
    if (!Number.isSafeInteger(length) || length < 1 || !body) {
      return refuse(fail(c, 400, "invalid_request"));
    }
    try {
      const stored = await putPart(c.env, c.var.device, linkId, part, length, body);
      if (stored !== "ok") return refuse(refusal(c, stored));
    } catch {
      // The body ended short of, or ran past, its Content-Length.
      return fail(c, 400, "invalid_request");
    }
    return c.body(null, 204);
  });

  app.openapi(completeHistoryTransferRoute, async (c) => {
    const { linkId } = c.req.valid("param");
    const done = await completeTransfer(c.env, c.var.device, linkId);
    if (done !== "ok") return refusal(c, done);
    log("history.completed", { deviceId: c.var.device.deviceId });
    return c.body(null, 204);
  });

  app.openapi(getHistoryRoute, async (c) => {
    const { linkId } = c.req.valid("param");
    const found = await getTransfer(c.env, c.var.device, linkId, c.req.header("range"));
    if ("error" in found) return refusal(c, found.error);
    if ("unsatisfiable" in found) {
      return c.body(null, 416, { "content-range": `bytes */${found.unsatisfiable}` });
    }
    const headers = { "content-type": "application/octet-stream", "accept-ranges": "bytes" };
    if (!found.range) {
      return c.body(found.ok.body, 200, { ...headers, "content-length": String(found.size) });
    }
    const { offset, length } = found.range;
    return c.body(found.ok.body, 206, {
      ...headers,
      "content-length": String(length),
      "content-range": `bytes ${offset}-${offset + length - 1}/${found.size}`,
    });
  });

  app.openapi(deleteHistoryRoute, async (c) => {
    const { linkId } = c.req.valid("param");
    const deleted = await deleteTransfer(c.env, c.var.device, linkId);
    if (deleted !== "ok") return refusal(c, deleted);
    log("history.deleted", { deviceId: c.var.device.deviceId });
    return c.body(null, 204);
  });
}
