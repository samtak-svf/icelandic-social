import { env, exports } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { base64url } from "../src/bytes.ts";
import { inbox } from "../src/env/index.ts";
import { hexBytes, mls } from "./mls.ts";
import { connect } from "./socket.ts";
import { device, euEnv } from "./support.ts";

// Delivery end to end (decisions 0015, 0017), over HTTP and the socket only,
// with the real OpenMLS messages of the fixture: B stocks KeyPackages, A
// claims one and adds B with a commit and its Welcome, both are notified,
// fetch, ack and answer, and once B is offline its device is owed a push.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => exports.default.fetch(`${BASE}${path}`, init);
const post = (path: string, body: unknown, auth: Record<string, string>) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(body),
  });

const CONVERSATION = base64url(hexBytes(mls.messages[0]!.groupId));
const MESSAGES = `/v1/conversations/${CONVERSATION}/messages`;
const notify = (seq: number) => ({ type: "notify", conversationId: CONVERSATION, seq });

async function send(name: string, auth: Record<string, string>, extra: object = {}) {
  const clientMsgId = name.replaceAll(" ", "_");
  const response = await post(
    MESSAGES,
    { clientMsgId, ciphertext: mls.base64(name), ...extra },
    auth,
  );
  expect(response.status, name).toBe(200);
  return ((await response.json()) as { seq: number }).seq;
}

async function list(after: number, auth: Record<string, string>) {
  const response = await fetch(`${MESSAGES}?after=${after}`, { headers: auth });
  expect(response.status).toBe(200);
  return response.json();
}

describe("delivery", () => {
  it("adds a member through a claimed KeyPackage and carries messages both ways", async () => {
    const a = await device();
    const b = await device();

    // B's device stocks a KeyPackage and a last resort.
    const stocked = await post(
      "/v1/key-packages",
      { keyPackages: [b.keyPackage], lastResort: b.keyPackage },
      b.auth,
    );
    expect(await stocked.json()).toEqual({ available: 1 });

    const socketA = await connect(a.auth);
    const socketB = await connect(b.auth);
    expect((await socketA.next()).type).toBe("hello");
    expect((await socketB.next()).type).toBe("hello");

    // A creates the group's conversation and claims B's package.
    expect((await post("/v1/conversations", { conversationId: CONVERSATION }, a.auth)).status).toBe(
      200,
    );
    const claimed = await post(`/v1/accounts/${b.accountId}/key-packages`, {}, a.auth);
    expect(await claimed.json()).toEqual({
      keyPackages: [{ deviceId: b.deviceId, keyPackage: b.keyPackage }],
    });

    // The commit that adds B carries B's Welcome.
    const add = await send("add b", a.auth, {
      ciphertext: mls.claimed("add b", [a.accountId, b.accountId], [b.accountId]),
      welcome: { message: mls.welcomeBase64 },
    });
    expect(add).toBe(1);
    expect(await socketA.next()).toEqual(notify(1));
    expect(await socketB.next()).toEqual(notify(1));

    // B does not know the conversation: it joins from the Welcome, then
    // fetches what came after the commit that carried it.
    const welcome = await fetch(`/v1/conversations/${CONVERSATION}/welcome`, { headers: b.auth });
    expect(await welcome.json()).toEqual({ seq: 1, welcome: mls.welcomeBase64 });
    expect(await list(1, b.auth)).toEqual({ messages: [], more: false });
    socketA.send({ type: "ack", conversationId: CONVERSATION, seq: 1 });
    socketB.send({ type: "ack", conversationId: CONVERSATION, seq: 1 });

    expect(await send("a to b", a.auth)).toBe(2);
    expect(await socketB.next()).toEqual(notify(2));
    expect(await list(1, b.auth)).toEqual({
      messages: [{ seq: 2, ciphertext: mls.base64("a to b") }],
      more: false,
    });
    socketB.send({ type: "ack", conversationId: CONVERSATION, seq: 2 });

    expect(await send("b to a", b.auth)).toBe(3);
    expect(await socketA.next()).toEqual(notify(2));
    expect(await socketA.next()).toEqual(notify(3));
    expect(await list(2, a.auth)).toEqual({
      messages: [{ seq: 3, ciphertext: mls.base64("b to a") }],
      more: false,
    });
    socketA.send({ type: "ack", conversationId: CONVERSATION, seq: 3 });
    expect(await socketB.next()).toEqual(notify(3));
    socketB.send({ type: "ack", conversationId: CONVERSATION, seq: 3 });
    await socketB.settle("before-close");

    // B goes offline; A's next message is owed to B's device as a push.
    socketB.ws.close(1000, "bye");
    await socketB.closed;
    const update = mls.claimed("a updates", [a.accountId, b.accountId]);
    expect(await send("a updates", a.auth, { ciphertext: update })).toBe(4);
    expect(await socketA.next()).toEqual(notify(4));
    await expect
      .poll(() =>
        runInDurableObject(inbox(euEnv(env), b.accountId), (_, state) =>
          state.storage.sql
            .exec("SELECT device_id, conversation_id, seq FROM push_outbox")
            .toArray(),
        ),
      )
      .toEqual([{ device_id: b.deviceId, conversation_id: CONVERSATION, seq: 4 }]);

    // Back online, B is told what it missed.
    const again = await connect(b.auth);
    expect((await again.next()).type).toBe("hello");
    expect(await again.next()).toEqual(notify(4));
  });
});
