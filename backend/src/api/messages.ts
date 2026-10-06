import { createRoute, z } from "@hono/zod-openapi";
import { AUTHED, base64, DEVICE_TOKEN, errorResponse, INVALID, OpaqueId } from "./common.ts";

// Stored messages go over REST (decision 0015). The server sees ciphertext
// and the unencrypted MLS framing only (decision 0002).

/** An MLS message; media goes to R2 and is referenced from inside it. */
const Ciphertext = base64(64 * 1024);
const Seq = z.int().min(0);
const params = z.object({ conversationId: OpaqueId });

const SendMessage = z
  .object({
    clientMsgId: OpaqueId.openapi({ description: "Sending it again answers the same seq" }),
    ciphertext: Ciphertext,
  })
  .openapi("SendMessage");

const Sent = z.object({ seq: Seq }).openapi("Sent");

const StoredMessage = z.object({ seq: Seq, ciphertext: Ciphertext }).openapi("StoredMessage");

const MessagePage = z
  .object({
    messages: z.array(StoredMessage).openapi({ description: "Oldest first" }),
    more: z.boolean().openapi({ description: "More messages follow the last one" }),
  })
  .openapi("MessagePage");

export const sendMessageRoute = createRoute({
  method: "post",
  path: "/v1/conversations/{conversationId}/messages",
  operationId: "sendMessage",
  tags: ["messages"],
  summary: "Store a message in the conversation and notify its members",
  security: DEVICE_TOKEN,
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: SendMessage } } },
  },
  responses: {
    200: { description: "Stored at seq", content: { "application/json": { schema: Sent } } },
    ...INVALID,
    409: errorResponse(
      "epoch_conflict: this epoch already has a commit; re-propose on the new one",
    ),
    ...AUTHED,
  },
});

export const listMessagesRoute = createRoute({
  method: "get",
  path: "/v1/conversations/{conversationId}/messages",
  operationId: "listMessages",
  tags: ["messages"],
  summary: "The stored messages after a seq",
  security: DEVICE_TOKEN,
  request: {
    params,
    query: z.object({
      after: z.coerce.number().int().min(0),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    }),
  },
  responses: {
    200: {
      description: "A page of messages",
      content: { "application/json": { schema: MessagePage } },
    },
    ...INVALID,
    ...AUTHED,
  },
});
