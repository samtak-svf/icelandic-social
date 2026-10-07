import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { base64url } from "../src/bytes.ts";
import { inbox } from "../src/env/index.ts";
import { hexBytes, mls } from "./mls.ts";
import { device, euEnv } from "./support.ts";

// Push (decision 0025): each device registers its own token, only an urgent
// message pushes, a newer urgent message re-arms a device's push, and one
// round sends a device at most one push however many conversations owe it.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => exports.default.fetch(`${BASE}${path}`, init);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;
const call = (method: string, path: string, auth: Record<string, string>, body?: unknown) =>
  fetch(path, {
    method,
    headers: { "content-type": "application/json", ...auth },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });

const testEnv = euEnv(env);

async function pushToken(deviceId: string) {
  return env.DB.prepare(
    "SELECT push_token AS token, push_sandbox AS sandbox FROM devices WHERE device_id = ?",
  )
    .bind(deviceId)
    .first<{ token: string | null; sandbox: number }>();
}

async function outbox(accountId: string) {
  return runInDurableObject(inbox(testEnv, accountId), (_, state) =>
    state.storage.sql
      .exec(
        "SELECT device_id, conversation_id, seq, pushed FROM push_outbox ORDER BY conversation_id",
      )
      .toArray(),
  );
}

describe("push tokens", () => {
  it("are set and removed by the device itself", async () => {
    const me = await device();
    const path = `/v1/devices/${me.deviceId}/push`;

    expect((await call("PUT", path, me.auth, { token: "fcm-token-1" })).status).toBe(204);
    expect(await pushToken(me.deviceId)).toEqual({ token: "fcm-token-1", sandbox: 0 });

    expect((await call("PUT", path, me.auth, { token: "apns-1", sandbox: true })).status).toBe(204);
    expect(await pushToken(me.deviceId)).toEqual({ token: "apns-1", sandbox: 1 });

    expect((await call("DELETE", path, me.auth)).status).toBe(204);
    expect(await pushToken(me.deviceId)).toEqual({ token: null, sandbox: 0 });
  });

  it("refuse another device's token, even one of the same account", async () => {
    const phone = await device();
    const tablet = await device({ accountId: phone.accountId });
    const path = `/v1/devices/${tablet.deviceId}/push`;

    const put = await call("PUT", path, phone.auth, { token: "fcm-token-2" });
    expect(put.status).toBe(403);
    expect(await errorOf(put)).toBe("not_this_device");
    const removed = await call("DELETE", path, phone.auth);
    expect(removed.status).toBe(403);
    expect(await pushToken(tablet.deviceId)).toEqual({ token: null, sandbox: 0 });
  });

  it("move with the token: the device that had it loses it", async () => {
    const old = await device();
    const next = await device();
    await call("PUT", `/v1/devices/${old.deviceId}/push`, old.auth, { token: "moved-token" });
    await call("PUT", `/v1/devices/${next.deviceId}/push`, next.auth, { token: "moved-token" });
    expect(await pushToken(old.deviceId)).toEqual({ token: null, sandbox: 0 });
    expect(await pushToken(next.deviceId)).toEqual({ token: "moved-token", sandbox: 0 });
  });

  it("are cleared when the device is revoked", async () => {
    const phone = await device();
    const tablet = await device({ accountId: phone.accountId });
    await call("PUT", `/v1/devices/${tablet.deviceId}/push`, tablet.auth, { token: "gone-token" });
    expect((await call("DELETE", `/v1/devices/${tablet.deviceId}`, phone.auth)).status).toBe(204);
    expect(await pushToken(tablet.deviceId)).toEqual({ token: null, sandbox: 0 });
  });

  it("refuse an empty or oversized token", async () => {
    const me = await device();
    const path = `/v1/devices/${me.deviceId}/push`;
    expect((await call("PUT", path, me.auth, { token: "" })).status).toBe(400);
    expect((await call("PUT", path, me.auth, { token: "x".repeat(4097) })).status).toBe(400);
  });
});

describe("the push outbox", () => {
  let logs: MockInstance<typeof console.log>;
  beforeEach(() => {
    logs = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => logs.mockRestore());

  /** The devices a push was sent to, in order, since the last call. */
  const pushed = () => {
    const devices = logs.mock.calls
      .map(([line]) => JSON.parse(String(line)) as { event: string; deviceId?: string })
      .filter((line) => line.event === "push.skipped")
      .map((line) => line.deviceId);
    logs.mockClear();
    return devices;
  };

  it("owes nothing for a message that is not urgent", async () => {
    const me = await device();
    await inbox(testEnv, me.accountId).notify(me.accountId, "conv_quiet", 4, 0);
    expect(await outbox(me.accountId)).toEqual([]);
    expect(pushed()).toEqual([]);
  });

  it("owes a push up to the latest urgent seq, and a newer one re-arms it", async () => {
    const me = await device();
    const box = inbox(testEnv, me.accountId);

    await box.notify(me.accountId, "conv_rearm", 1, 1);
    expect(pushed()).toEqual([me.deviceId]);
    expect(await outbox(me.accountId)).toEqual([
      { device_id: me.deviceId, conversation_id: "conv_rearm", seq: 1, pushed: 1 },
    ]);

    // A receipt after it: no new push.
    await box.notify(me.accountId, "conv_rearm", 2, 1);
    expect(pushed()).toEqual([]);

    // A second urgent message: the device never acked, and is pushed again.
    await box.notify(me.accountId, "conv_rearm", 3, 3);
    expect(pushed()).toEqual([me.deviceId]);
    expect(await outbox(me.accountId)).toEqual([
      { device_id: me.deviceId, conversation_id: "conv_rearm", seq: 3, pushed: 1 },
    ]);

    // The same notification again, as a retry: nothing new.
    await box.notify(me.accountId, "conv_rearm", 3, 3);
    expect(pushed()).toEqual([]);
  });

  it("sends a device one push for everything owed in a round", async () => {
    const me = await device();
    await runInDurableObject(inbox(testEnv, me.accountId), (_, state) => {
      for (const id of ["conv_one", "conv_two"]) {
        state.storage.sql.exec(
          "INSERT INTO push_outbox (device_id, conversation_id, seq) VALUES (?, ?, 1)",
          me.deviceId,
          id,
        );
      }
    });
    await inbox(testEnv, me.accountId).notify(me.accountId, "conv_three", 1, 1);
    expect(pushed()).toEqual([me.deviceId]);
    expect((await outbox(me.accountId)).map((r) => r.pushed)).toEqual([1, 1, 1]);
  });
});

describe("urgency", () => {
  const CONVERSATION = base64url(hexBytes(mls.messages[0]!.groupId));
  const MESSAGES = `/v1/conversations/${CONVERSATION}/messages`;

  async function send(auth: Record<string, string>, body: object) {
    const response = await call("POST", MESSAGES, auth, body);
    expect(response.status).toBe(200);
    return ((await response.json()) as { seq: number }).seq;
  }

  it("pushes a message to the other accounts only, and a commit or an urgent: false to no one", async () => {
    const a = await device();
    await device({ accountId: a.accountId }); // A's tablet, offline
    const b = await device();
    await call("POST", "/v1/conversations", a.auth, { conversationId: CONVERSATION });
    await send(a.auth, {
      clientMsgId: "add_b",
      ciphertext: mls.claimed("add b", [a.accountId, b.accountId], [b.accountId]),
      welcome: { message: mls.welcomeBase64 },
      groupInfo: mls.groupInfo("add b"),
    });
    const text = await send(a.auth, { clientMsgId: "text", ciphertext: mls.base64("a to b") });
    const receipt = await send(a.auth, {
      clientMsgId: "receipt",
      ciphertext: mls.base64("a to b"),
      urgent: false,
    });
    expect(receipt).toBe(text + 1);

    // B is owed the text and nothing after it; A's own tablet is owed nothing.
    await expect
      .poll(() => outbox(b.accountId))
      .toEqual([{ device_id: b.deviceId, conversation_id: CONVERSATION, seq: text, pushed: 1 }]);
    const latest = await inbox(testEnv, a.accountId).latest();
    expect(latest[CONVERSATION]).toBe(receipt);
    expect(await outbox(a.accountId)).toEqual([]);
  });
});
