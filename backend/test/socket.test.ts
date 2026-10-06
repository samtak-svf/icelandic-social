import { env } from "cloudflare:workers";
import { evictDurableObject, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { conversation, inbox } from "../src/env/index.ts";
import { connect } from "./socket.ts";
import { device, euEnv } from "./support.ts";

// The socket of decision 0015 against the real Inbox and Conversation DOs:
// hello and catch-up, ack, typing, push for a device with no socket, and
// hibernation.

const testEnv = euEnv(env);
const TYPING = "dHlwaW5n";

async function outbox(accountId: string) {
  return runInDurableObject(inbox(testEnv, accountId), (_, state) =>
    state.storage.sql
      .exec("SELECT device_id, conversation_id, seq, pushed FROM push_outbox ORDER BY device_id")
      .toArray(),
  );
}

describe("the socket", () => {
  it("says hello, then notifies what this device has missed", async () => {
    const me = await device();
    await inbox(testEnv, me.accountId).notify(me.accountId, "conv_seen", 3);
    const socket = await connect(me.auth);
    const hello = await socket.next();
    expect(hello).toMatchObject({ type: "hello", protocol: 1 });
    expect(await socket.next()).toEqual({ type: "notify", conversationId: "conv_seen", seq: 3 });

    socket.send({ type: "ack", conversationId: "conv_seen", seq: 3 });
    socket.ws.close();
    const again = await connect(me.auth);
    expect((await again.next()).type).toBe("hello");
    expect(await again.settle("n1")).toEqual({ type: "pong", nonce: "n1" });
  });

  it("notifies an open socket, and owes one push to a device without one until it acks", async () => {
    const online = await device();
    const offline = await device({ accountId: online.accountId });
    const socket = await connect(online.auth);
    await socket.next();

    const box = inbox(testEnv, online.accountId);
    await box.notify(online.accountId, "conv_push", 1);
    expect(await socket.next()).toEqual({ type: "notify", conversationId: "conv_push", seq: 1 });
    expect(await outbox(online.accountId)).toEqual([
      { device_id: offline.deviceId, conversation_id: "conv_push", seq: 1, pushed: 1 },
    ]);

    // Still one row, already pushed: no second push until the device acks.
    await box.notify(online.accountId, "conv_push", 2);
    expect(await outbox(online.accountId)).toEqual([
      { device_id: offline.deviceId, conversation_id: "conv_push", seq: 2, pushed: 1 },
    ]);

    const late = await connect(offline.auth);
    expect((await late.next()).type).toBe("hello");
    expect(await late.next()).toEqual({ type: "notify", conversationId: "conv_push", seq: 2 });
    late.send({ type: "ack", conversationId: "conv_push", seq: 2 });
    await late.settle("n2");
    expect(await outbox(online.accountId)).toEqual([]);
  });

  it("does not notify a device of what it has acked", async () => {
    const me = await device();
    const socket = await connect(me.auth);
    await socket.next();
    socket.send({ type: "ack", conversationId: "conv_ack", seq: 5 });
    await socket.settle("n3");
    await inbox(testEnv, me.accountId).notify(me.accountId, "conv_ack", 5);
    expect(await socket.settle("n4")).toEqual({ type: "pong", nonce: "n4" });
    expect(await outbox(me.accountId)).toEqual([]);
  });

  it("relays typing to the other members' sockets and stores nothing", async () => {
    const a = await device();
    const b = await device();
    const outsider = await device();
    const id = "conv_typing";
    const stub = conversation(testEnv, id);
    await stub.create(a.accountId, id);
    await stub.send({
      account: a.accountId,
      clientMsgId: "add",
      ciphertext: Uint8Array.of(1),
      commitEpoch: 0,
      roster: { add: [b.accountId] },
    });

    const [sa, sb, so] = [
      await connect(a.auth),
      await connect(b.auth),
      await connect(outsider.auth),
    ];
    for (const s of [sa, sb, so]) await s.next();
    sa.send({ type: "typing", conversationId: id, ciphertext: TYPING });
    expect(await sb.nextOf("typing")).toEqual({
      type: "typing",
      conversationId: id,
      ciphertext: TYPING,
    });
    expect(await sa.settle("n5")).toEqual({ type: "pong", nonce: "n5" });

    // An outsider's typing reaches nobody.
    so.send({ type: "typing", conversationId: id, ciphertext: TYPING });
    await so.settle("n6");
    expect(await sb.settle("n7")).toEqual({ type: "pong", nonce: "n7" });

    const page = await stub.list(a.accountId, 0, 10);
    expect("ok" in page && page.ok.messages.map((m) => m.seq)).toEqual([1]);
  });

  it.each([
    ["not JSON", "{"],
    ["a frame that does not parse", JSON.stringify({ type: "ack", seq: -1 })],
    [
      "a frame only the server sends",
      JSON.stringify({ type: "notify", conversationId: "c", seq: 1 }),
    ],
  ])("closes with 1008 on %s", async (_, raw) => {
    const me = await device();
    const socket = await connect(me.auth);
    await socket.next();
    socket.ws.send(raw);
    expect((await socket.closed).code).toBe(1008);
  });

  it("answers a close the client starts, and then owes that device a push", async () => {
    const me = await device();
    const socket = await connect(me.auth);
    await socket.next();
    socket.ws.close(1000, "bye");
    expect((await socket.closed).code).toBe(1000);

    await inbox(testEnv, me.accountId).notify(me.accountId, "conv_closed", 1);
    expect(await outbox(me.accountId)).toEqual([
      { device_id: me.deviceId, conversation_id: "conv_closed", seq: 1, pushed: 1 },
    ]);
  });

  it("acts as the device the token names, whatever the client claims", async () => {
    const me = await device();
    const socket = await connect(me.auth, { "x-spjall-device": "d_other" });
    await socket.next();
    socket.send({ type: "ack", conversationId: "conv_claim", seq: 1 });
    await socket.settle("n8");
    const cursors = await runInDurableObject(inbox(testEnv, me.accountId), (_, state) =>
      state.storage.sql.exec("SELECT device_id FROM cursors").toArray(),
    );
    expect(cursors).toEqual([{ device_id: me.deviceId }]);
  });

  it("keeps a socket's device across hibernation", async () => {
    const me = await device();
    const socket = await connect(me.auth);
    await socket.next();
    await evictDurableObject(inbox(testEnv, me.accountId));
    socket.send({ type: "ack", conversationId: "conv_sleep", seq: 4 });
    expect(await socket.settle("n9")).toEqual({ type: "pong", nonce: "n9" });
    const cursors = await runInDurableObject(inbox(testEnv, me.accountId), (_, state) =>
      state.storage.sql.exec("SELECT device_id, seq FROM cursors").toArray(),
    );
    expect(cursors).toEqual([{ device_id: me.deviceId, seq: 4 }]);
  });
});
