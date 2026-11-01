import { createRoute, z } from "@hono/zod-openapi";
import { ACCOUNT, AUTHED, errorResponse, OpaqueId } from "./common.ts";
import { json } from "./social.ts";

// A person's own export (decision 0126): a ZIP of their posts, comments, reactions, profile and
// friends, built by a job and downloaded from the same screen. Only its owner reaches any of it.

const tags = ["exports"];
const Binary = z.string().openapi({ type: "string", format: "binary" });
const Params = z.object({ exportId: OpaqueId });

const ExportSummary = z
  .object({
    exportId: OpaqueId,
    state: z.enum(["building", "ready", "failed"]),
    failure: z.string().nullable().openapi({
      description: "With failed, why: too_big, lost or stalled",
    }),
    size: z.int().nullable().openapi({ description: "The file's bytes, once ready" }),
    createdAt: z.int().openapi({ description: "Milliseconds since the epoch" }),
    expiresAt: z.int().openapi({
      description: "Milliseconds since the epoch; the file is gone after this",
    }),
  })
  .openapi("ExportSummary");

export const createExportRoute = createRoute({
  method: "post",
  path: "/v1/exports",
  operationId: "createExport",
  tags,
  summary: "Ask for a file of the caller's own content; a job builds it",
  description:
    "Allowed for a suspended account, since the content is its own. One export per account in 24 hours, unless the last one failed.",
  security: ACCOUNT,
  responses: {
    201: json("The export, building", ExportSummary),
    409: errorResponse("conflict: one is building, or one was made in the last 24 hours"),
    ...AUTHED,
  },
});

export const listExportsRoute = createRoute({
  method: "get",
  path: "/v1/exports",
  operationId: "listExports",
  tags,
  summary: "The caller's exports that have not expired, newest first",
  security: ACCOUNT,
  responses: {
    200: json("The exports", z.object({ exports: z.array(ExportSummary) }).openapi("ExportList")),
    ...AUTHED,
  },
});

export const getExportFileRoute = createRoute({
  method: "get",
  path: "/v1/exports/{exportId}/file",
  operationId: "getExportFile",
  tags,
  summary: "Download the caller's own export, a ZIP",
  description:
    "A single `Range: bytes=a-b` or `bytes=a-` answers 206 with that slice. Another person's export answers not_found.",
  security: ACCOUNT,
  request: { params: Params },
  responses: {
    200: { description: "The ZIP", content: { "application/zip": { schema: Binary } } },
    206: {
      description: "The slice a Range asked for, with its content-range",
      content: { "application/zip": { schema: Binary } },
    },
    416: {
      description:
        "The range starts past the end, is reversed, a suffix or several ranges; content-range is `bytes */<size>`",
    },
    404: errorResponse("not_found: no such export of the caller's"),
    409: errorResponse("conflict: the export is not ready"),
    410: errorResponse("expired: the file is past its 7 days"),
    ...AUTHED,
  },
});
