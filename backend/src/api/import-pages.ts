import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, RATE_LIMITED } from "./common.ts";
import { json } from "./social.ts";

// A connection to a page the person manages on another platform (decision 0120). The
// person signs in there at /auth/page/start, the pages they manage are offered for an
// hour, and the one they choose comes in and stays in step. A token is never returned.

const tags = ["imports"];
const SUSPENDED = {
  403: errorResponse(
    "suspended: the account is suspended now, with `until` when it ends (decision 0115)",
  ),
};

const ImportPageOffer = z
  .object({ pageId: z.string(), pageName: z.string() })
  .openapi("ImportPageOffer");

const ImportPageConnection = z
  .object({
    importId: OpaqueId,
    pageId: z.string(),
    pageName: z.string(),
    state: z.enum(["importing", "preview", "connected"]).openapi({
      description:
        "preview: the first collection waits to be chosen from, under the import's routes",
    }),
    outcome: z.enum(["expired", "failed", "ok"]).nullable().openapi({
      description: "How the last run ended; expired means the person has to sign in there again",
    }),
    posts: z.int().openapi({ description: "Posts brought in so far" }),
    lastSyncAt: z.int().nullable().openapi({ description: "Milliseconds since the epoch" }),
  })
  .openapi("ImportPageConnection");

const CreateImportPage = z
  .object({
    pageId: z.string().min(1).max(64),
    audience: z.enum(["friends", "everyone"]).optional().openapi({
      description:
        "Who reads the posts; friends when left out, since nothing is public unless chosen",
    }),
  })
  .openapi("CreateImportPage");

export const listImportPagesRoute = createRoute({
  method: "get",
  path: "/v1/imports/pages",
  operationId: "listImportPages",
  tags,
  summary: "Whether the page feed is on, the pages on offer, and the caller's connections",
  security: ACCOUNT,
  responses: {
    200: json(
      "The offers by name, the connections oldest first",
      z
        .object({
          available: z.boolean(),
          offers: z.array(ImportPageOffer),
          connections: z.array(ImportPageConnection),
        })
        .openapi("ImportPageList"),
    ),
    ...AUTHED,
  },
});

export const createImportPageRoute = createRoute({
  method: "post",
  path: "/v1/imports/pages",
  operationId: "createImportPage",
  tags,
  summary: "Connect a page on offer to the caller",
  security: ACCOUNT,
  request: {
    body: { required: true, content: { "application/json": { schema: CreateImportPage } } },
  },
  responses: {
    201: json("The first collection begins; watch the connection's state", ImportPageConnection),
    404: errorResponse("not_found: no such page on offer to the caller"),
    409: errorResponse("conflict: the caller has as many connections as one person may"),
    503: errorResponse("unavailable: this feed is switched off here"),
    ...SUSPENDED,
    ...INVALID,
    ...RATE_LIMITED,
    ...AUTHED,
  },
});

export const deleteImportPageRoute = createRoute({
  method: "delete",
  path: "/v1/imports/pages/{importId}",
  operationId: "deleteImportPage",
  tags,
  summary: "Stop a page connection and remove every post it brought in",
  security: ACCOUNT,
  request: { params: z.object({ importId: OpaqueId }) },
  responses: {
    204: { description: "Removal has begun" },
    404: errorResponse("not_found: no such connection of the caller's"),
    ...INVALID,
    ...AUTHED,
  },
});
