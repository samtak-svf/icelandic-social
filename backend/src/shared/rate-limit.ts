import type { Context } from "hono";
import { type RateLimit, withinLimit } from "../env/index.ts";
import type { AppEnv } from "../http.ts";
import { fail } from "./errors.ts";
import { log } from "./log.ts";

// The one way a route spends a rate limit and refuses when it is spent. The
// buckets, and what spends each, are on RateLimit in env/index.ts.

/** Whether this request is over `limit` for `key`. A request that is gets its log line here. */
export async function overLimit(
  c: Context<AppEnv>,
  limit: RateLimit,
  key: string,
): Promise<boolean> {
  if (await withinLimit(c.env, limit, key)) return false;
  log("request.rate_limited", { code: limit, requestId: c.var.requestId });
  return true;
}

/** `overLimit` on the `public` bucket by the caller's address; a request with no address is let through. */
export async function overAddressLimit(c: Context<AppEnv>): Promise<boolean> {
  const address = c.req.header("cf-connecting-ip");
  return address ? overLimit(c, "public", address) : false;
}

/** The answer to a request `overLimit` stopped. */
export const rateLimited = (c: Context<AppEnv>) => fail(c, 429, "rate_limited");
