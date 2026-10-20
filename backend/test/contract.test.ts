import { beforeAll, describe, expect, it } from "vitest";
import { createApp, DOCUMENT_INFO } from "../src/app.ts";
import { ApiError } from "../src/api/common.ts";
import { WsFrame } from "../src/api/frames.ts";
import { device, revoke } from "./support.ts";
import { worker } from "./main.ts";

// The delivery contract of decisions 0014 and 0015: every route is in the
// document with an operation id, every route but device registration needs a
// device token that names an active device, and the handlers not built yet
// answer 501. test/messages.test.ts covers the conversation routes.

const BASE = "https://spjall.test";
/** Seeded in beforeAll; built, not written out, so it reads as no secret. */
const TOKEN_VALUE = `dt_${"0".repeat(32)}`;
const TOKEN = { authorization: `Bearer ${TOKEN_VALUE}` };
const CIPHERTEXT = "AAEC";

const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const json = (body: unknown, headers: Record<string, string> = {}): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

describe("the delivery contract", () => {
  beforeAll(async () => {
    await device({ token: TOKEN_VALUE });
  });

  it("documents every route with an operation id", () => {
    const document = createApp().getOpenAPI31Document(DOCUMENT_INFO);
    const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
      Object.entries(item ?? {}).map(([method, op]) => `${method} ${path} ${op.operationId}`),
    );
    expect(operations.sort()).toEqual([
      "delete /v1/blocks/{accountId} unblockAccount",
      "delete /v1/comments/{commentId} deleteComment",
      "delete /v1/communities/{communityId} deleteCommunity",
      "delete /v1/communities/{communityId}/join withdrawJoinRequest",
      "delete /v1/communities/{communityId}/join-requests/{accountId} declineJoinRequest",
      "delete /v1/conversations/{conversationId}/mute unmuteConversation",
      "delete /v1/devices/{deviceId} revokeDevice",
      "delete /v1/devices/{deviceId}/push clearPushToken",
      "delete /v1/me deleteAccount",
      "delete /v1/me/invite revokeInvite",
      "delete /v1/me/photo removePhoto",
      "delete /v1/posts/{postId} deletePost",
      "delete /v1/posts/{postId}/reaction unreact",
      "delete /v1/sessions/{sessionId} endSession",
      "get /health getHealth",
      "get /v1/accounts/{accountId} getAccount",
      "get /v1/accounts/{accountId}/photo getPhoto",
      "get /v1/blocks listBlocks",
      "get /v1/communities listCommunities",
      "get /v1/communities/{communityId} getCommunity",
      "get /v1/communities/{communityId}/join-requests listJoinRequests",
      "get /v1/communities/{communityId}/members listCommunityMembers",
      "get /v1/communities/{communityId}/moderation-log communityModerationLog",
      "get /v1/communities/{communityId}/posts listCommunityPosts",
      "get /v1/communities/{communityId}/reports communityReports",
      "get /v1/conversations/{conversationId}/devices getConversationDevices",
      "get /v1/conversations/{conversationId}/group-info getGroupInfo",
      "get /v1/conversations/{conversationId}/media/{mediaId} getMedia",
      "get /v1/conversations/{conversationId}/messages listMessages",
      "get /v1/conversations/{conversationId}/welcome getWelcome",
      "get /v1/devices/link-requests/{linkId} getDeviceLinkRequest",
      "get /v1/devices/me/store-key getLinkedStoreKey",
      "get /v1/feed getFeed",
      "get /v1/invites/{token} resolveInvite",
      "get /v1/me getMe",
      "get /v1/me/communities myCommunities",
      "get /v1/me/sessions listSessions",
      "get /v1/moderation/log platformModerationLog",
      "get /v1/moderation/reports platformReports",
      "get /v1/mutes listMutes",
      "get /v1/notifications notifications",
      "get /v1/people listPeople",
      "get /v1/posts/{postId} getPost",
      "get /v1/posts/{postId}/comments listComments",
      "get /v1/posts/{postId}/media/{mediaId} getPostMedia",
      "get /v1/sign-in getSignInConfig",
      "get /v1/ws openSocket",
      "patch /v1/communities/{communityId} updateCommunity",
      "post /v1/accounts/{accountId}/key-packages claimKeyPackages",
      "post /v1/cards resolveCards",
      "post /v1/communities createCommunity",
      "post /v1/communities/{communityId}/actions moderate",
      "post /v1/communities/{communityId}/join joinCommunity",
      "post /v1/communities/{communityId}/join-requests/{accountId} approveJoinRequest",
      "post /v1/communities/{communityId}/leave leaveCommunity",
      "post /v1/communities/{communityId}/media uploadSocialMedia",
      "post /v1/communities/{communityId}/posts createPost",
      "post /v1/communities/{communityId}/restore restoreCommunity",
      "post /v1/conversations createConversation",
      "post /v1/conversations/{conversationId}/messages sendMessage",
      "post /v1/devices registerDevice",
      "post /v1/devices/link-requests createDeviceLinkRequest",
      "post /v1/devices/link-requests/{linkId}/approve approveDeviceLinkRequest",
      "post /v1/devices/link-requests/{linkId}/complete completeDeviceLinkRequest",
      "post /v1/key-packages uploadKeyPackages",
      "post /v1/me/identities linkIdentity",
      "post /v1/me/invite rotateInvite",
      "post /v1/me/sessions/end-others endOtherSessions",
      "post /v1/notifications/read readNotifications",
      "post /v1/posts/{postId}/comments createComment",
      "post /v1/reports report",
      "post /v1/reports/{reportId}/close closeReport",
      "put /v1/blocks/{accountId} blockAccount",
      "put /v1/communities/{communityId}/invitations/{accountId} inviteToCommunity",
      "put /v1/communities/{communityId}/members/{accountId}/role setCommunityRole",
      "put /v1/communities/{communityId}/owner transferCommunity",
      "put /v1/conversations/{conversationId}/media/{mediaId} putMedia",
      "put /v1/conversations/{conversationId}/mute muteConversation",
      "put /v1/devices/{deviceId}/push setPushToken",
      "put /v1/me/photo setPhoto",
      "put /v1/posts/{postId}/reaction react",
    ]);
  });

  it("gives every stored message the time the server stored it (0048)", () => {
    const document = createApp().getOpenAPI31Document(DOCUMENT_INFO);
    const stored = document.components?.schemas?.["StoredMessage"] as { required?: string[] };
    expect(stored.required).toContain("storedAt");
  });

  it("points the socket route at the frame union", () => {
    const document = createApp().getOpenAPI31Document(DOCUMENT_INFO);
    expect(document.paths?.["/v1/ws"]?.get?.["x-ws-frames"]).toEqual({
      $ref: "#/components/schemas/WsFrame",
    });
  });

  it.each([
    ["DELETE", "/v1/devices/d_1"],
    ["DELETE", "/v1/me"],
    ["GET", "/v1/conversations/c_1/messages?after=0"],
    ["POST", "/v1/conversations/c_1/messages"],
    ["POST", "/v1/conversations"],
    ["GET", "/v1/conversations/c_1/welcome"],
    ["POST", "/v1/key-packages"],
    ["POST", "/v1/accounts/a_1/key-packages"],
    ["GET", "/v1/ws"],
  ])("refuses %s %s without a device token", async (method, path) => {
    const response = await fetch(path, { method });
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toBe("unauthorized");
  });

  it("refuses a malformed bearer token", async () => {
    const response = await fetch("/v1/me", {
      method: "DELETE",
      headers: { authorization: "Bearer" },
    });
    expect(response.status).toBe(401);
  });

  it("refuses a Welcome without its message", async () => {
    const response = await fetch(
      "/v1/conversations/c_1/messages",
      json({ clientMsgId: "m_1", ciphertext: CIPHERTEXT, welcome: {} }, TOKEN),
    );
    expect(response.status).toBe(400);
  });

  it("refuses a well-formed token that names no device", async () => {
    const response = await fetch("/v1/me", {
      method: "DELETE",
      headers: { authorization: `Bearer dt_${"f".repeat(32)}` },
    });
    expect(response.status).toBe(401);
    expect(await errorOf(response)).toBe("unauthorized");
  });

  it("refuses the token of a revoked device", async () => {
    const revoked = await device();
    await revoke(revoked.deviceId);
    const response = await fetch("/v1/me", { method: "DELETE", headers: revoked.auth });
    expect(response.status).toBe(401);
  });

  it("lets an active device's token through to the handler", async () => {
    const active = await device();
    const response = await fetch("/v1/me", { headers: active.auth });
    expect(response.status).toBe(200);
  });

  it("validates a send before it reaches the handler", async () => {
    const response = await fetch(
      "/v1/conversations/c_1/messages",
      json({ clientMsgId: "m_1", ciphertext: "not base64!" }, TOKEN),
    );
    expect(response.status).toBe(400);
  });

  it("asks for an upgrade on the socket route", async () => {
    const response = await fetch("/v1/ws", { headers: TOKEN });
    expect(response.status).toBe(426);
    expect(await errorOf(response)).toBe("upgrade_required");
  });

  it("parses every frame of the protocol", () => {
    const frames = [
      { type: "hello", protocol: 1, serverTime: "2026-10-06T00:00:00Z" },
      { type: "notify", conversationId: "c_1", seq: 7 },
      { type: "ack", conversationId: "c_1", seq: 7 },
      { type: "typing", conversationId: "c_1", ciphertext: CIPHERTEXT },
      { type: "ping", nonce: "n" },
      { type: "pong", nonce: "n" },
    ];
    for (const frame of frames) expect(WsFrame.parse(frame)).toEqual(frame);
    expect(() =>
      WsFrame.parse({ type: "typing", conversationId: "c_1", ciphertext: "?" }),
    ).toThrow();
  });
});
