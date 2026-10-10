import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AppEnv } from "./app.ts";
import { log } from "./log.ts";

// The request id and every error answer (decision 0037). Each request gets an
// id, Cloudflare's ray id when there is one; it goes back in x-request-id on
// every response and in `requestId` in every error body, and on the log line
// of a failure, so a person can quote it and the line can be found by it. It
// is opaque and random, never derived from the account or the device (0008).
// tooling/seam-guard.mjs refuses an error body built anywhere but here.

const REQUEST_ID_HEADER = "x-request-id";

/** A ray id is hex and a data-centre code; anything else is not trusted as one. */
const RAY = /^[A-Za-z0-9-]{1,64}$/;

/** The id of a request: its cf-ray when that is an opaque id, else a new UUID. */
function requestIdOf(ray: string | undefined): string {
  return ray !== undefined && RAY.test(ray) ? ray : crypto.randomUUID();
}

/** First in the chain: names the request on the context and on the response. */
export const requestId = createMiddleware<AppEnv>(async (c, next) => {
  const id = requestIdOf(c.req.header("cf-ray"));
  c.set("requestId", id);
  await next();
  // A WebSocket upgrade's 101 cannot be copied to add a header to it.
  if (c.res.status !== 101) c.header(REQUEST_ID_HEADER, id);
});

/** An error answer: the stable code, the request id, and minVersion with a 426. */
export function fail<S extends ContentfulStatusCode>(
  c: Context<AppEnv>,
  status: S,
  error: string,
  extra: { minVersion?: string } = {},
) {
  return c.json({ error, ...extra, requestId: c.var.requestId }, status);
}

/**
 * What a thrown error answers. A body that is not JSON is the client's
 * mistake; anything else is ours, logged with the request id and never with
 * the error's message, which may hold what the request carried (0008).
 */
export function failed(error: Error, c: Context<AppEnv>) {
  if (error instanceof HTTPException && error.status < 500) {
    return fail(c, error.status as ContentfulStatusCode, "invalid_request");
  }
  log("request.failed", { code: "internal_error", status: 500, requestId: c.var.requestId });
  return fail(c, 500, "internal_error");
}
