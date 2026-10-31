import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, INVALID } from "./common.ts";
import { json, PostPage } from "./social.ts";

// The first tab (decision 0116): what a person's communities, friends and own
// wall have posted, newest first. A contract of its own, because `getFeed` stays
// what installed apps read.

/** How far back one read of the feed looks, widening while pages come up short. */
export const HOME_WINDOW_DAYS = [1, 4, 16, 30] as const;

/**
 * The longest page, and the one a client gets by asking for none. Each post may
 * cost a call to its space, so this is what decision 0116 shortens if the
 * measurement fails, and no client may ask past it.
 */
const HOME_PAGE = 30;

/** Two parts, so a client can name only a width the server would read. */
const HomeCursor = z
  .string()
  .regex(new RegExp(`^(${HOME_WINDOW_DAYS.join("|")})\\.\\d{1,16}(-[A-Za-z0-9_-]{1,160})?$`))
  .openapi({ description: "The `next` of the page before" });

export const homeRoute = createRoute({
  method: "get",
  path: "/v1/home",
  operationId: "getHome",
  tags: ["social"],
  summary: "The posts of the caller's communities, friends and own wall, newest first",
  description:
    "Read a time window at a time, widening while pages come up short, so a page can be short or empty while older posts remain: follow `next` until it is null.",
  security: ACCOUNT,
  request: {
    query: z.object({
      before: HomeCursor.optional(),
      limit: z.coerce.number().int().min(1).max(HOME_PAGE).default(HOME_PAGE),
    }),
  },
  responses: { 200: json("A page", PostPage), ...INVALID, ...AUTHED },
});
