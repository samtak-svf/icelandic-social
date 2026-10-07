import { createRoute, z } from "@hono/zod-openapi";
import { AUTHED, ConversationId, DEVICE_TOKEN, errorResponse, MEMBER } from "./common.ts";

// Photos and files (decision 0023): opaque ciphertext in R2, bound to one
// conversation and readable by its roster. The key is inside MLS.

/** 128 random bits, unpadded base64url, chosen by the core. */
const MediaId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22}$/)
  .openapi({ example: "Zm9vYmFyYmF6cXV4cXV1eA" });

const params = z.object({ conversationId: ConversationId, mediaId: MediaId });

const Binary = z.string().openapi({ type: "string", format: "binary" });

export const putMediaRoute = createRoute({
  method: "put",
  path: "/v1/conversations/{conversationId}/media/{mediaId}",
  operationId: "putMedia",
  tags: ["media"],
  summary: "Store the ciphertext of a photo or file for the conversation",
  description:
    "The body is the core's ciphertext, with a Content-Length. It is kept 30 days, and deleted with the account that sent it.",
  security: DEVICE_TOKEN,
  request: {
    params,
    body: { required: true, content: { "application/octet-stream": { schema: Binary } } },
  },
  responses: {
    204: { description: "Stored" },
    400: errorResponse("invalid_request: no Content-Length, or a body of another length"),
    ...MEMBER,
    409: errorResponse("conflict: an object with this id exists"),
    413: errorResponse("too_large: more than 25 MB of plaintext"),
    ...AUTHED,
  },
});

export const getMediaRoute = createRoute({
  method: "get",
  path: "/v1/conversations/{conversationId}/media/{mediaId}",
  operationId: "getMedia",
  tags: ["media"],
  summary: "Fetch the ciphertext of a photo or file, as a member of the conversation",
  security: DEVICE_TOKEN,
  request: { params },
  responses: {
    200: {
      description: "The ciphertext",
      content: { "application/octet-stream": { schema: Binary } },
    },
    403: MEMBER[403],
    404: errorResponse("not_found: no such conversation, or no such object in it"),
    ...AUTHED,
  },
});
