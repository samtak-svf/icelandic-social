import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RETENTION_MS, type SendInput } from "../src/do/conversation.ts";
import { conversation, inbox } from "../src/env/index.ts";
import { euEnv } from "./support.ts";

// The Conversation DO on its own (decisions 0015, 0017): order, the epoch
// rule, the roster, Welcomes, fan-out and retention. Each test has its own
// conversation; the bytes are opaque here, since the Worker reads the framing.

const testEnv = euEnv(env);
let made = 0;

async function created(creator = "a") {
  const id = `conv_${++made}`;
  const stub = conversation(testEnv, id);
  expect(await stub.create(creator, id)).toEqual({ ok: null });
  return { id, stub };
}

const bytes = (n: number) => Uint8Array.of(n);
const message = (account: string, clientMsgId: string, more: Partial<SendInput> = {}) => ({
  account,
  clientMsgId,
  ciphertext: bytes(clientMsgId.length),
  ...more,
});

describe("a conversation", () => {
  it("answers its creator again and refuses anyone else", async () => {
    const { id, stub } = await created("a");
    expect(await stub.create("a", id)).toEqual({ ok: null });
    expect(await stub.create("b", id)).toEqual({ error: "conversation_exists" });
  });

  it("is not found before it is created", async () => {
    const stub = conversation(testEnv, "conv_never");
    expect(await stub.send(message("a", "m1"))).toEqual({ error: "not_found" });
    expect(await stub.list("a", 0, 10)).toEqual({ error: "not_found" });
  });

  it("numbers messages in order and answers a resend with the first seq", async () => {
    const { stub } = await created();
    expect(await stub.send(message("a", "m1"))).toEqual({ ok: { seq: 1 } });
    expect(await stub.send(message("a", "m2"))).toEqual({ ok: { seq: 2 } });
    expect(await stub.send(message("a", "m1"))).toEqual({ ok: { seq: 1 } });
    const page = await stub.list("a", 0, 10);
    expect("ok" in page && page.ok.messages.map((m) => m.seq)).toEqual([1, 2]);
  });

  it("refuses an account that is not a member", async () => {
    const { stub } = await created("a");
    expect(await stub.send(message("x", "m1"))).toEqual({ error: "not_a_member" });
    expect(await stub.list("x", 0, 10)).toEqual({ error: "not_a_member" });
    expect(await stub.welcome("x")).toEqual({ error: "not_a_member" });
  });

  it("stores one commit per epoch, and older application messages too", async () => {
    const { stub } = await created();
    expect(await stub.send(message("a", "c0", { commitEpoch: 0 }))).toEqual({ ok: { seq: 1 } });
    expect(await stub.send(message("a", "c0b", { commitEpoch: 0 }))).toEqual({
      error: "epoch_conflict",
    });
    expect(await stub.send(message("a", "c2", { commitEpoch: 2 }))).toEqual({
      error: "epoch_conflict",
    });
    expect(await stub.send(message("a", "c1", { commitEpoch: 1 }))).toEqual({ ok: { seq: 2 } });
    // An application message made on epoch 0 still arrives.
    expect(await stub.send(message("a", "late"))).toEqual({ ok: { seq: 3 } });
  });

  it("moves the roster only with the commit that wins its epoch", async () => {
    const { stub } = await created("a");
    await stub.send(message("a", "add", { commitEpoch: 0, roster: { add: ["b", "c"] } }));
    expect(await stub.send(message("b", "hi"))).toEqual({ ok: { seq: 2 } });

    const lost = await stub.send(
      message("b", "kick", { commitEpoch: 0, roster: { remove: ["a"] } }),
    );
    expect(lost).toEqual({ error: "epoch_conflict" });
    expect(await stub.send(message("a", "still"))).toEqual({ ok: { seq: 3 } });

    await stub.send(message("a", "remove", { commitEpoch: 1, roster: { remove: ["c"] } }));
    expect(await stub.send(message("c", "gone"))).toEqual({ error: "not_a_member" });
    expect(await stub.list("c", 0, 10)).toEqual({ error: "not_a_member" });
  });

  it("keeps a Welcome for the accounts it is to, at its commit's seq", async () => {
    const { stub } = await created("a");
    await stub.send(message("a", "m1"));
    const welcome = { to: ["b"], message: bytes(9) };
    const sent = await stub.send(
      message("a", "add", { commitEpoch: 0, roster: { add: ["b", "c"] }, welcome }),
    );
    expect(sent).toEqual({ ok: { seq: 2 } });
    expect(await stub.welcome("b")).toEqual({ ok: { seq: 2, welcome: bytes(9) } });
    expect(await stub.welcome("c")).toEqual({ error: "not_found" });
    expect(await stub.welcome("a")).toEqual({ error: "not_found" });
  });

  it("refuses a Welcome for an account the commit does not add", async () => {
    const { stub } = await created("a");
    const welcome = { to: ["b"], message: bytes(9) };
    expect(await stub.send(message("a", "add", { commitEpoch: 0, welcome }))).toEqual({
      error: "welcome_not_a_member",
    });
    // Refused whole: the epoch is still free.
    expect(await stub.send(message("a", "add2", { commitEpoch: 0 }))).toEqual({ ok: { seq: 1 } });
  });

  it("pages messages after a seq", async () => {
    const { stub } = await created();
    for (const n of [1, 2, 3, 4, 5]) await stub.send(message("a", `m${n}`));
    const first = await stub.list("a", 0, 2);
    expect("ok" in first && first.ok.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect("ok" in first && first.ok.more).toBe(true);
    const last = await stub.list("a", 3, 2);
    expect("ok" in last && last.ok.messages.map((m) => m.seq)).toEqual([4, 5]);
    expect("ok" in last && last.ok.more).toBe(false);
  });

  it("notifies every member's inbox, and a removed one of its removal only", async () => {
    const { id, stub } = await created("n_a");
    await stub.send(message("n_a", "add", { commitEpoch: 0, roster: { add: ["n_b", "n_c"] } }));
    await stub.send(message("n_a", "drop", { commitEpoch: 1, roster: { remove: ["n_c"] } }));
    await stub.send(message("n_b", "hi"));
    await runDurableObjectAlarm(stub);
    expect(await inbox(testEnv, "n_a").latest()).toEqual({ [id]: 3 });
    expect(await inbox(testEnv, "n_b").latest()).toEqual({ [id]: 3 });
    expect(await inbox(testEnv, "n_c").latest()).toEqual({ [id]: 2 });
    await runInDurableObject(stub, (_, state) => {
      expect(state.storage.sql.exec("SELECT * FROM pending_notify").toArray()).toEqual([]);
    });
  });

  it("deletes messages and Welcomes 30 days after they were stored", async () => {
    const { stub } = await created("a");
    const welcome = { to: ["b"], message: bytes(9) };
    await stub.send(message("a", "add", { commitEpoch: 0, roster: { add: ["b"] }, welcome }));
    await stub.send(message("a", "new"));
    await runDurableObjectAlarm(stub);
    await runInDurableObject(stub, (_, state) => {
      const old = Date.now() - RETENTION_MS - 1;
      state.storage.sql.exec("UPDATE messages SET stored_at = ? WHERE seq = 1", old);
      state.storage.sql.exec("UPDATE welcomes SET stored_at = ?", old);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const page = await stub.list("a", 0, 10);
    expect("ok" in page && page.ok.messages.map((m) => m.seq)).toEqual([2]);
    expect(await stub.welcome("b")).toEqual({ error: "not_found" });
    // The next alarm waits for the newest message to expire.
    await runInDurableObject(stub, async (_, state) => {
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + RETENTION_MS - 60_000);
    });
  });
});
