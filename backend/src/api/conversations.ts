import { createRoute, z } from "@hono/zod-openapi";
import {
  AUTHED,
  ConversationId,
  DEVICE_TOKEN,
  errorResponse,
  INVALID,
  MEMBER,
  OpaqueId,
} from "./common.ts";
import { Ciphertext, params, Seq } from "./messages.ts";

// A conversation on the server is a roster of accounts under the MLS group id
// (decision 0017).

const CreateConversation = z
  .object({ conversationId: ConversationId })
  .openapi("CreateConversation");

const Conversation = z.object({ conversationId: ConversationId }).openapi("Conversation");

const GroupInfo = z
  .object({
    seq: Seq.openapi({ description: "The commit it is of; fetch messages after the join's own" }),
    groupInfo: Ciphertext.openapi({ description: "The MLS GroupInfo, with the ratchet tree" }),
  })
  .openapi("GroupInfo");

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

export const getGroupInfoRoute = createRoute({
  method: "get",
  path: "/v1/conversations/{conversationId}/group-info",
  operationId: "getGroupInfo",
  tags: ["conversations"],
  summary: "The latest commit's GroupInfo, for a device of a member account to join from",
  security: DEVICE_TOKEN,
  request: { params },
  responses: {
    200: {
      description: "The GroupInfo of the current epoch (decision 0021)",
      content: { "application/json": { schema: GroupInfo } },
    },
    ...INVALID,
    ...MEMBER,
    ...AUTHED,
  },
});

const ConversationDevices = z
  .object({
    accounts: z
      .array(z.object({ accountId: OpaqueId, deviceIds: z.array(OpaqueId) }))
      .openapi({ description: "Every roster account, with the devices the server still serves" }),
  })
  .openapi("ConversationDevices");

export const getConversationDevicesRoute = createRoute({
  method: "get",
  path: "/v1/conversations/{conversationId}/devices",
  operationId: "getConversationDevices",
  tags: ["conversations"],
  summary: "The active devices of each member account, to remove any other leaf (decision 0028)",
  security: DEVICE_TOKEN,
  request: { params },
  responses: {
    200: {
      description: "A deleted account's entry has no devices",
      content: { "application/json": { schema: ConversationDevices } },
    },
    ...INVALID,
    ...MEMBER,
    ...AUTHED,
  },
});
