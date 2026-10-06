import { createRoute, z } from "@hono/zod-openapi";
import { AUTHED, ConversationId, DEVICE_TOKEN, errorResponse, INVALID, MEMBER } from "./common.ts";
import { Ciphertext, params, Seq } from "./messages.ts";

// A conversation on the server is a roster of accounts under the MLS group id
// (decision 0017).

const CreateConversation = z
  .object({ conversationId: ConversationId })
  .openapi("CreateConversation");

const Conversation = z.object({ conversationId: ConversationId }).openapi("Conversation");

const Welcome = z
  .object({
    seq: Seq.openapi({
      description: "The commit that added this account; fetch messages after it",
    }),
    welcome: Ciphertext.openapi({ description: "The MLS Welcome" }),
  })
  .openapi("Welcome");

export const createConversationRoute = createRoute({
  method: "post",
  path: "/v1/conversations",
  operationId: "createConversation",
  tags: ["conversations"],
  summary: "Create a conversation with this account as its only member",
  security: DEVICE_TOKEN,
  request: {
    body: { required: true, content: { "application/json": { schema: CreateConversation } } },
  },
  responses: {
    200: {
      description: "The conversation exists and this account created it",
      content: { "application/json": { schema: Conversation } },
    },
    ...INVALID,
    409: errorResponse("conversation_exists: another account created it"),
    ...AUTHED,
  },
});

export const getWelcomeRoute = createRoute({
  method: "get",
  path: "/v1/conversations/{conversationId}/welcome",
  operationId: "getWelcome",
  tags: ["conversations"],
  summary: "The Welcome that added this account to the conversation",
  security: DEVICE_TOKEN,
  request: { params },
  responses: {
    200: {
      description: "The latest Welcome for this account",
      content: { "application/json": { schema: Welcome } },
    },
    ...INVALID,
    ...MEMBER,
    ...AUTHED,
  },
});
