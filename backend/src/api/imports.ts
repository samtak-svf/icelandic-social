import { createRoute, z } from "@hono/zod-openapi";
import { LIMITS } from "../limits.gen.ts";
import {
  ACCOUNT,
  AUTHED,
  errorResponse,
  INVALID,
  OpaqueId,
  RATE_LIMITED,
  SUSPENDED,
} from "./common.ts";
import { WallAudience } from "./post-fields.ts";
import { Cursor, json, PostPage } from "./social.ts";

// Importing a person's own posts from an export file (decision 0119): the ZIP
// goes up in parts, a job reads it into a preview, the person chooses, and a
// second job publishes the choice to their wall. Only its owner reaches any of it.

const tags = ["imports"];
const Binary = z.string().openapi({ type: "string", format: "binary" });
const Params = z.object({ importId: OpaqueId });
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

/** What kind of post a preview row is (decision 0127); only `own` comes unless chosen. */
const ImportItemClass = z
  .enum(["own", "link", "other_timeline", "hidden"])
  .openapi("ImportItemClass");
export type ItemClass = z.infer<typeof ImportItemClass>;
export const ITEM_CLASSES = ImportItemClass.options;

const ImportStatus = z
  .object({
    state: z.enum(["uploading", "parsing", "ready", "publishing", "done", "failed", "removing"]),
    failure: z.string().nullable().openapi({
      description:
        "With failed, why: truncated, zip64, encrypted, unsupported, too_big, corrupt, no_posts or outdated",
    }),
    counts: z.object({
      posts: z.int(),
      images: z.int(),
      videos: z.int(),
      skipped: z.int().openapi({ description: "Entries in a shape this does not read" }),
      earliest: z.int().nullable().openapi({ description: "Milliseconds since the epoch" }),
      latest: z.int().nullable().openapi({ description: "Milliseconds since the epoch" }),
    }),
    classes: z
      .array(
        z.object({
          class: ImportItemClass,
          posts: z.int(),
          images: z.int().openapi({ description: "The images that come with these posts" }),
          imagesLost: z.int().openapi({
            description: "Images missing from the file, too large, or past what a post holds",
          }),
          videos: z.int().openapi({ description: "Posts whose video stays behind" }),
        }),
      )
      .openapi({ description: "What the file held, per kind of post" }),
    lost: z
      .object({
        videoOnly: z.int().openapi({ description: "Entries that were only a video" }),
        foreignOnly: z.int().openapi({ description: "Someone else's image with no own words" }),
        foreignImages: z.int().openapi({ description: "Someone else's images on own posts" }),
        empty: z.int().openapi({ description: "Entries with nothing that could come" }),
      })
      .openapi({ description: "What the file held and no post will carry" }),
  })
  .openapi("ImportStatus");

const ImportSummary = ImportStatus.extend({
  importId: OpaqueId,
  createdAt: z.int().openapi({ description: "Milliseconds since the epoch" }),
}).openapi("ImportSummary");

const HeldQuery = {
  class: ImportItemClass.optional(),
  year: z.coerce.number().int().min(1970).max(9999).optional().openapi({
    description: "Only posts of this year, by their original date in UTC",
  }),
};

const ImportDetail = ImportStatus.extend({
  held: z
    .object({
      posts: z.int().openapi({ description: "Posts still held, seen by nobody but the caller" }),
      groups: z.array(z.object({ class: ImportItemClass, year: z.int(), posts: z.int() })),
    })
    .openapi({ description: "What this import brought in and the caller has not opened" }),
}).openapi("ImportDetail");

const OpenHeld = z
  .object({
    audience: WallAudience,
    class: ImportItemClass.optional().openapi({ description: "Only this kind of post" }),
    year: z.int().min(1970).max(9999).optional().openapi({ description: "Only this year" }),
  })
  .openapi("OpenHeld");

const OpenedHeld = z.object({ opened: z.int() }).openapi("OpenedHeld");

const ImportItem = z
  .object({
    id: z.string(),
    at: z.int().openapi({ description: "The post's original date, milliseconds since the epoch" }),
    text: z.string(),
    images: z.int(),
    hasVideo: z.boolean().openapi({ description: "A video is not carried over (decision 0120)" }),
    class: ImportItemClass,
  })
  .openapi("ImportItem");

const ImportItemPage = z
  .object({ items: z.array(ImportItem), next: Cursor.nullable() })
  .openapi("ImportItemPage");

const PublishImport = z
  .object({
    from: z.int().min(0).optional().openapi({ description: "Only posts from this date on" }),
    to: z.int().min(0).optional().openapi({ description: "Only posts up to this date" }),
    excluded: z.array(z.string().max(64)).max(LIMITS.excludedPostsCount).optional().openapi({
      description: "Ids of posts to leave out",
    }),
    classes: z.array(ImportItemClass).min(1).max(4).optional().openapi({
      description: "The kinds of post to bring in; only the person's own when left out",
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

export const listImportsRoute = createRoute({
  method: "get",
  path: "/v1/imports",
  operationId: "listImports",
  tags,
  summary: "The caller's file imports, newest first, without any being removed",
  security: ACCOUNT,
  responses: {
    200: json(
      "The latest 100",
      z.object({ imports: z.array(ImportSummary) }).openapi("ImportList"),
    ),
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
  responses: { 200: json("The import", ImportDetail), 404: NOT_FOUND, ...INVALID, ...AUTHED },
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

export const listHeldRoute = createRoute({
  method: "get",
  path: "/v1/imports/{importId}/held",
  operationId: "listHeldPosts",
  tags,
  summary: "The posts this import holds, newest first, as the caller's own to review",
  security: ACCOUNT,
  request: {
    params: Params,
    query: z.object({ ...HeldQuery, before: Cursor.optional() }),
  },
  responses: { 200: json("A page", PostPage), 404: NOT_FOUND, ...INVALID, ...AUTHED },
});

export const openHeldRoute = createRoute({
  method: "post",
  path: "/v1/imports/{importId}/open",
  operationId: "openHeldPosts",
  tags,
  summary: "Open the held posts, all of them or one kind or year, to an audience",
  security: ACCOUNT,
  request: {
    params: Params,
    body: { required: true, content: { "application/json": { schema: OpenHeld } } },
  },
  responses: {
    200: json("How many posts were opened", OpenedHeld),
    404: NOT_FOUND,
    409: errorResponse("conflict: posts are still coming in"),
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
