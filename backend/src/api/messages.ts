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

const WelcomeMessage = z
  .object({
    message: Ciphertext.openapi({
      description: "The MLS Welcome, for the accounts the commit's claim names",
    }),
  })
  .openapi("WelcomeMessage");

const SendMessage = z
  .object({
    clientMsgId: OpaqueId.openapi({ description: "Sending it again answers the same seq" }),
    ciphertext: Ciphertext,
    welcome: WelcomeMessage.optional().openapi({
      description: "With a commit whose claim names whom it is for, and only then",
    }),
    groupInfo: Ciphertext.optional().openapi({
      description:
        "With every commit, and only then: the MLS GroupInfo, with the ratchet tree, of the epoch the commit starts (decision 0021)",
    }),
  })
  .openapi("SendMessage", {
    description:
      "A commit's authenticated_data holds its claim, the JSON {roster, welcome}: every account in the group after it, and the accounts its Welcome is for. The roster becomes the claim's when the commit is stored (decision 0020)",
  });

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
      "invalid_request: a commit without a claim that names its sender, a welcome its claim does not name anyone for, a welcome or groupInfo without a commit, a commit without the GroupInfo of its group's next epoch, or an external commit that is not the sending device's own leaf or that changes the roster; group_mismatch: the framing names another group",
    ),
    403: errorResponse(
      "not_a_member: this account is not in the conversation; blocked: the commit adds an account that has blocked this one (decision 0024)",
    ),
    404: MEMBER[404],
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
