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

// Muting (decision 0042): a row in the account's Inbox, checked before a push.

const MuteFor = z.enum(["1h", "8h", "always"]).openapi("MuteFor", {
  description: "1 hour, 8 hours, or until turned back on",
});

const MuteRequest = z.object({ for: MuteFor }).openapi("MuteRequest");

const Mute = z
  .object({
    conversationId: ConversationId,
    until: z.int().nullable().openapi({
      description:
        "When the mute ends, Unix milliseconds by the server's clock; null until turned back on",
    }),
  })
  .openapi("Mute");

export const muteConversationRoute = createRoute({
  method: "put",
  path: "/v1/conversations/{conversationId}/mute",
  operationId: "muteConversation",
  tags: ["conversations"],
  summary: "Mute a conversation: its messages still arrive, but no push wakes a device",
  description:
    "The server sets the end by its own clock. Every open socket of the account gets a mute frame.",
  security: DEVICE_TOKEN,
  request: {
    params,
    body: { required: true, content: { "application/json": { schema: MuteRequest } } },
  },
  responses: {
    200: { description: "The mute", content: { "application/json": { schema: Mute } } },
    ...INVALID,
    ...MEMBER,
    ...AUTHED,
  },
});

export const unmuteConversationRoute = createRoute({
  method: "delete",
  path: "/v1/conversations/{conversationId}/mute",
  operationId: "unmuteConversation",
  tags: ["conversations"],
  summary: "Turn a conversation's notifications back on",
  security: DEVICE_TOKEN,
  request: { params },
  responses: {
    204: { description: "The conversation is not muted" },
    ...INVALID,
    ...MEMBER,
    ...AUTHED,
  },
});

const Mutes = z
  .object({ mutes: z.array(Mute).openapi({ description: "Only mutes still in force" }) })
  .openapi("Mutes");

export const listMutesRoute = createRoute({
  method: "get",
  path: "/v1/mutes",
  operationId: "listMutes",
  tags: ["conversations"],
  summary: "The conversations this account has muted (decision 0042)",
  security: DEVICE_TOKEN,
  responses: {
    200: { description: "The mutes", content: { "application/json": { schema: Mutes } } },
    ...AUTHED,
  },
});
