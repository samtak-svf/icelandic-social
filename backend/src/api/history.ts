import { createRoute, z } from "@hono/zod-openapi";
import { AUTHED, DEVICE_TOKEN, errorResponse, INVALID, OpaqueId } from "./common.ts";

// History from a sibling device (decision 0064, #300): the phone that approved
// a link uploads its history, sealed by the core to the link's one-time X25519
// key, in parts; the device the link made downloads it once and deletes it.
// The server holds opaque ciphertext for at most 24 hours and no key to it.

const Binary = z.string().openapi({ type: "string", format: "binary" });

const LinkParams = z.object({ linkId: OpaqueId });

const CreateHistoryTransfer = z
  .object({
    size: z.int().min(1).openapi({ description: "The ciphertext's length in bytes" }),
  })
  .openapi("CreateHistoryTransfer");

const HistoryTransfer = z
  .object({
    partSize: z.int().openapi({
      description: "Every part but the last is this many bytes; the last is the remainder",
    }),
    parts: z.int().openapi({ description: "How many parts to upload, numbered from 1" }),
    expiresAt: z.int().openapi({ description: "Milliseconds since the epoch" }),
  })
  .openapi("HistoryTransfer");

const NOT_THIS_DEVICE = errorResponse(
  "not_this_device: only the phone that approved the link uploads, and only the device it made downloads",
);
const NOT_FOUND = errorResponse("not_found: no approved link, or no transfer on it");
const EXPIRED = errorResponse("expired: the transfer is past its 24 hours");

export const createHistoryTransferRoute = createRoute({
  method: "post",
  path: "/v1/devices/link-requests/{linkId}/history",
  operationId: "createHistoryTransfer",
  tags: ["devices"],
  summary: "Start uploading this phone's history for the device a link makes (decision 0064)",
  description:
    "Only the active phone that approved the link, once per link. The ciphertext is at most 1 GiB of history and its framing.",
  security: DEVICE_TOKEN,
  request: {
    params: LinkParams,
    body: {
      required: true,
      content: { "application/json": { schema: CreateHistoryTransfer } },
    },
  },
  responses: {
    201: {
      description: "Upload the parts, then complete",
      content: { "application/json": { schema: HistoryTransfer } },
    },
    ...INVALID,
    ...AUTHED,
    403: NOT_THIS_DEVICE,
    404: NOT_FOUND,
    409: errorResponse("conflict: this link has a transfer already"),
    413: errorResponse("too_large: more than 1 GiB of history"),
  },
});

export const putHistoryPartRoute = createRoute({
  method: "put",
  path: "/v1/devices/link-requests/{linkId}/history/parts/{part}",
  operationId: "putHistoryPart",
  tags: ["devices"],
  summary: "Upload one part of a history transfer; a repeated part replaces the first",
  description: "The body is exactly the part's length, with a Content-Length.",
  security: DEVICE_TOKEN,
  request: {
    params: LinkParams.extend({ part: z.coerce.number().int().min(1) }),
    body: { required: true, content: { "application/octet-stream": { schema: Binary } } },
  },
  responses: {
    204: { description: "Stored" },
    400: errorResponse(
      "invalid_request: no such part, no Content-Length, or a body of another length",
    ),
    ...AUTHED,
    403: NOT_THIS_DEVICE,
    404: NOT_FOUND,
    409: errorResponse("conflict: the transfer is complete"),
    410: EXPIRED,
  },
});

export const completeHistoryTransferRoute = createRoute({
  method: "post",
  path: "/v1/devices/link-requests/{linkId}/history/complete",
  operationId: "completeHistoryTransfer",
  tags: ["devices"],
  summary: "Finish a history transfer once every part is uploaded",
  security: DEVICE_TOKEN,
  request: { params: LinkParams },
  responses: {
    204: { description: "The history is ready for the linked device" },
    ...INVALID,
    ...AUTHED,
    403: NOT_THIS_DEVICE,
    404: NOT_FOUND,
    409: errorResponse("incomplete: a part is missing; conflict: the transfer is complete"),
    410: EXPIRED,
  },
});

export const getHistoryRoute = createRoute({
  method: "get",
  path: "/v1/devices/link-requests/{linkId}/history",
  operationId: "getHistory",
  tags: ["devices"],
  summary: "Download the history a link's approving phone uploaded, as the device it made",
  description:
    "The ciphertext stays until the device deletes it or 24 hours pass, so a download that breaks can be repeated. A single `Range: bytes=a-b` or `bytes=a-` answers 206 with that slice, so a browser fetches the file in pieces (decision 0081).",
  security: DEVICE_TOKEN,
  request: { params: LinkParams },
  responses: {
    200: {
      description: "The ciphertext",
      content: { "application/octet-stream": { schema: Binary } },
    },
    206: {
      description: "The slice a Range asked for, with its content-range",
      content: { "application/octet-stream": { schema: Binary } },
    },
    416: {
      description:
        "The range starts past the end, is reversed, a suffix or several ranges; content-range is `bytes */<size>`",
    },
    ...INVALID,
    ...AUTHED,
    403: NOT_THIS_DEVICE,
    404: errorResponse("not_found: no approved link, or no completed transfer on it"),
    410: EXPIRED,
  },
});

export const deleteHistoryRoute = createRoute({
  method: "delete",
  path: "/v1/devices/link-requests/{linkId}/history",
  operationId: "deleteHistory",
  tags: ["devices"],
  summary: "Delete a history transfer: the linked device once it has it, or the phone to cancel",
  security: DEVICE_TOKEN,
  request: { params: LinkParams },
  responses: {
    204: { description: "Deleted, or there was nothing to delete" },
    ...INVALID,
    ...AUTHED,
    403: NOT_THIS_DEVICE,
    404: errorResponse("not_found: no approved link"),
  },
});
