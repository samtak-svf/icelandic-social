import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, INVALID, OpaqueId, RATE_LIMITED } from "./common.ts";
import { Cursor, json } from "./social.ts";

// Importing a person's own posts from an export file (decision 0119): the ZIP
// goes up in parts, a job reads it into a preview, the person chooses, and a
// second job publishes the choice to their wall. Only its owner reaches any of it.

const tags = ["imports"];
const Binary = z.string().openapi({ type: "string", format: "binary" });
const Params = z.object({ importId: OpaqueId });
const SUSPENDED = {
  403: errorResponse(
    "suspended: the account is suspended now, with `until` when it ends (decision 0115)",
  ),
};
const NOT_FOUND = errorResponse("not_found: no such import of the caller's");

const CreateImportFile = z
  .object({ size: z.int().min(1).openapi({ description: "The ZIP's length in bytes" }) })
  .openapi("CreateImportFile");

const ImportFileUpload = z
  .object({
    importId: OpaqueId,
    partSize: z.int().openapi({
      description: "Every part but the last is this many bytes; the last is the remainder",
    }),
    parts: z.int().openapi({ description: "How many parts to upload, numbered from 1" }),
  })
  .openapi("ImportFileUpload");

const ImportStatus = z
  .object({
    state: z.enum(["uploading", "parsing", "ready", "publishing", "done", "failed", "removing"]),
    failure: z.string().nullable().openapi({
      description:
        "With failed, why: truncated, zip64, encrypted, unsupported, too_big, corrupt or no_posts",
    }),
    counts: z.object({
      posts: z.int(),
      images: z.int(),
      videos: z.int(),
      skipped: z.int().openapi({ description: "Entries in a shape this does not read" }),
      earliest: z.int().nullable().openapi({ description: "Milliseconds since the epoch" }),
      latest: z.int().nullable().openapi({ description: "Milliseconds since the epoch" }),
    }),
  })
  .openapi("ImportStatus");

const ImportItem = z
  .object({
    id: z.string(),
    at: z.int().openapi({ description: "The post's original date, milliseconds since the epoch" }),
    text: z.string(),
    images: z.int(),
    hasVideo: z.boolean().openapi({ description: "A video is not carried over (decision 0120)" }),
  })
  .openapi("ImportItem");

const ImportItemPage = z
  .object({ items: z.array(ImportItem), next: Cursor.nullable() })
  .openapi("ImportItemPage");

const PublishImport = z
  .object({
    audience: z.enum(["friends", "everyone"]).optional().openapi({
      description:
        "Who reads the posts; friends when left out, since nothing is public unless chosen",
    }),
    from: z.int().min(0).optional().openapi({ description: "Only posts from this date on" }),
    to: z.int().min(0).optional().openapi({ description: "Only posts up to this date" }),
    excluded: z.array(z.string().max(64)).max(1000).optional().openapi({
      description: "Ids of posts to leave out",
    }),
  })
  .openapi("PublishImport");

export const createImportFileRoute = createRoute({
  method: "post",
  path: "/v1/imports/file",
  operationId: "createImportFile",
  tags,
  summary: "Start uploading another platform's export file (a ZIP of at most 4 GiB less a byte)",
  security: ACCOUNT,
  request: {
    body: { required: true, content: { "application/json": { schema: CreateImportFile } } },
  },
  responses: {
    201: json("Upload the parts, then complete", ImportFileUpload),
    413: errorResponse("too_large: more than 4 GiB less a byte"),
    ...SUSPENDED,
    ...INVALID,
    ...RATE_LIMITED,
    ...AUTHED,
  },
});

export const putImportPartRoute = createRoute({
  method: "put",
  path: "/v1/imports/{importId}/parts/{part}",
  operationId: "putImportPart",
  tags,
  summary: "Upload one part of an import file; a repeated part replaces the first",
  description: "The body is exactly the part's length, with a Content-Length.",
  security: ACCOUNT,
  request: {
    params: Params.extend({ part: z.coerce.number().int().min(1) }),
    body: { required: true, content: { "application/octet-stream": { schema: Binary } } },
  },
  responses: {
    204: { description: "Stored" },
    400: errorResponse(
      "invalid_request: no such part, no Content-Length, or a body of another length",
    ),
    404: NOT_FOUND,
    409: errorResponse("conflict: the upload is complete"),
    410: errorResponse("expired: the upload is past its 7 days"),
    ...AUTHED,
  },
});

export const completeImportRoute = createRoute({
  method: "post",
  path: "/v1/imports/{importId}/complete",
  operationId: "completeImport",
  tags,
  summary: "Finish the upload once every part is stored; the file is then read",
  security: ACCOUNT,
  request: { params: Params },
  responses: {
    204: { description: "The file is being read; watch the import's state" },
    404: NOT_FOUND,
    409: errorResponse("incomplete: a part is missing; conflict: the upload is complete"),
    410: errorResponse("expired: the upload is past its 7 days"),
    ...INVALID,
    ...AUTHED,
  },
});

export const getImportRoute = createRoute({
  method: "get",
  path: "/v1/imports/{importId}",
  operationId: "getImport",
  tags,
  summary: "Where an import stands, and what the file held",
  security: ACCOUNT,
  request: { params: Params },
  responses: { 200: json("The import", ImportStatus), 404: NOT_FOUND, ...INVALID, ...AUTHED },
});

export const listImportItemsRoute = createRoute({
  method: "get",
  path: "/v1/imports/{importId}/items",
  operationId: "listImportItems",
  tags,
  summary: "The posts the file held, oldest first, to choose from",
  security: ACCOUNT,
  request: { params: Params, query: z.object({ cursor: Cursor.optional() }) },
  responses: { 200: json("A page", ImportItemPage), 404: NOT_FOUND, ...INVALID, ...AUTHED },
});

export const publishImportRoute = createRoute({
  method: "post",
  path: "/v1/imports/{importId}/publish",
  operationId: "publishImport",
  tags,
  summary: "Publish the chosen posts to the caller's wall, under their original dates",
  security: ACCOUNT,
  request: {
    params: Params,
    body: { required: true, content: { "application/json": { schema: PublishImport } } },
  },
  responses: {
    204: { description: "Publishing has begun; watch the import's state" },
    404: NOT_FOUND,
    409: errorResponse("conflict: the import is not ready"),
    ...SUSPENDED,
    ...INVALID,
    ...RATE_LIMITED,
    ...AUTHED,
  },
});

export const deleteImportRoute = createRoute({
  method: "delete",
  path: "/v1/imports/{importId}",
  operationId: "deleteImport",
  tags,
  summary: "Remove an import: the upload and preview at once, and every post it brought in",
  security: ACCOUNT,
  request: { params: Params },
  responses: { 204: { description: "Removal has begun" }, 404: NOT_FOUND, ...INVALID, ...AUTHED },
});
