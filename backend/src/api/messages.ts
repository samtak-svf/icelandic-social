import { createRoute, z } from "@hono/zod-openapi";
import {
  AUTHED,
  base64,
  ConversationId,
  DEVICE_TOKEN,
  errorResponse,
  INVALID,
  MEMBER,
  OpaqueId,
} from "./common.ts";

// Stored messages go over REST (decision 0015). The server sees ciphertext
// and the unencrypted MLS framing only (decision 0002); who is in a
// conversation is the roster that commits move (decision 0017).

/** An MLS message; media goes to R2 and is referenced from inside it. */
export const Ciphertext = base64(64 * 1024);
export const Seq = z.int().min(0);
export const params = z.object({ conversationId: ConversationId });
const AccountIds = z.array(OpaqueId).min(1).max(100);

const RosterChange = z
  .object({
    add: AccountIds.optional(),
    remove: AccountIds.optional(),
  })
  .openapi("RosterChange", {
    description: "Applied only if this commit is the one stored for its epoch (decision 0017)",
  });

const WelcomeFor = z
  .object({
    to: AccountIds.openapi({ description: "Accounts the Welcome is for; members after roster" }),
    message: Ciphertext.openapi({ description: "The MLS Welcome" }),
  })
  .openapi("WelcomeFor");

const SendMessage = z
  .object({
    clientMsgId: OpaqueId.openapi({ description: "Sending it again answers the same seq" }),
    ciphertext: Ciphertext,
    roster: RosterChange.optional().openapi({ description: "Only with a commit" }),
    welcome: WelcomeFor.optional().openapi({ description: "Only with a commit" }),
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
    400: errorResponse(
      "invalid_request, or group_mismatch: the framing names another group, or roster or welcome without a commit",
    ),
    ...MEMBER,
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
    ...MEMBER,
    ...AUTHED,
  },
});
