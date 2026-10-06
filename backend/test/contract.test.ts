import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp, DOCUMENT_INFO } from "../src/app.ts";
import { ApiError } from "../src/api/common.ts";
import { WsFrame } from "../src/api/frames.ts";
import { device, revoke } from "./support.ts";

// The delivery contract of decisions 0014 and 0015: every route is in the
// document with an operation id, every route but device registration needs a
// device token that names an active device, and the handlers not built yet
// answer 501. test/messages.test.ts covers the conversation routes.

const BASE = "https://spjall.test";
/** Seeded in beforeAll; built, not written out, so it reads as no secret. */
const TOKEN_VALUE = `dt_${"0".repeat(32)}`;
const TOKEN = { authorization: `Bearer ${TOKEN_VALUE}` };
const CIPHERTEXT = "AAEC";

const fetch = (path: string, init?: RequestInit) => exports.default.fetch(`${BASE}${path}`, init);
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
      "delete /v1/devices/{deviceId} revokeDevice",
      "delete /v1/me deleteAccount",
      "get /health getHealth",
      "get /v1/conversations/{conversationId}/messages listMessages",
      "get /v1/conversations/{conversationId}/welcome getWelcome",
      "get /v1/ws openSocket",
      "post /v1/accounts/{accountId}/key-packages claimKeyPackages",
      "post /v1/conversations createConversation",
      "post /v1/conversations/{conversationId}/messages sendMessage",
      "post /v1/devices registerDevice",
      "post /v1/key-packages uploadKeyPackages",
    ]);
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

  it("refuses a Welcome addressed to nobody", async () => {
    const response = await fetch(
      "/v1/conversations/c_1/messages",
      json(
        { clientMsgId: "m_1", ciphertext: CIPHERTEXT, welcome: { to: [], message: CIPHERTEXT } },
        TOKEN,
      ),
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
    const response = await fetch("/v1/me", { method: "DELETE", headers: active.auth });
    expect(response.status).toBe(501);
  });

  it("validates a send before it reaches the handler", async () => {
    const response = await fetch(
      "/v1/conversations/c_1/messages",
      json({ clientMsgId: "m_1", ciphertext: "not base64!" }, TOKEN),
    );
    expect(response.status).toBe(400);
  });

  it.each([
    ["/v1/devices/d_1", { method: "DELETE", headers: TOKEN }],
    ["/v1/me", { method: "DELETE", headers: TOKEN }],
    [
      "/v1/devices",
      json({
        kenniCode: "code",
        codeVerifier: "v".repeat(43),
        redirectUri: "is.samtak.spjall:/kenni",
        platform: "android",
        deviceKey: CIPHERTEXT,
      }),
    ],
  ])("answers %s with 501 until phase 1", async (path, init) => {
    const response = await fetch(path, init);
    expect(response.status).toBe(501);
    expect(await errorOf(response)).toBe("not_implemented");
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
