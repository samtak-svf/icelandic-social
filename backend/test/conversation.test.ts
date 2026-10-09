import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { RETENTION_MS, type SendInput } from "../src/do/conversation.ts";
import { conversation, inbox } from "../src/env/index.ts";
import { euEnv } from "./support.ts";

// The Conversation DO on its own (decisions 0015, 0017, 0020): order, the
// epoch rule, the roster each commit claims, history up to a removal,
// Welcomes, the GroupInfo and external commits (0021), fan-out and retention. Each test has its own
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
  urgent: more.urgent ?? false,
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

  it("takes its first commit at epoch 0 only", async () => {
    const { stub } = await created();
    expect(await stub.send(message("a", "c7", { commitEpoch: 7 }))).toEqual({
      error: "epoch_conflict",
    });
    expect(await stub.send(message("a", "c0", { commitEpoch: 0 }))).toEqual({ ok: { seq: 1 } });
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

  it("sets the roster to the claim of the commit that wins its epoch", async () => {
    const { stub } = await created("a");
    await stub.send(message("a", "add", { commitEpoch: 0, roster: ["a", "b", "c"] }));
    expect(await stub.send(message("b", "hi"))).toEqual({ ok: { seq: 2 } });

    const lost = await stub.send(message("b", "kick", { commitEpoch: 0, roster: ["b", "c"] }));
    expect(lost).toEqual({ error: "epoch_conflict" });
    expect(await stub.send(message("a", "still"))).toEqual({ ok: { seq: 3 } });

    await stub.send(message("a", "remove", { commitEpoch: 1, roster: ["a", "b"] }));
    expect(await stub.send(message("c", "gone"))).toEqual({ error: "not_a_member" });
    expect(await stub.welcome("c")).toEqual({ error: "not_a_member" });
  });

  it("lets an account a commit left out read up to that commit", async () => {
    const { stub } = await created("a");
    await stub.send(message("a", "add", { commitEpoch: 0, roster: ["a", "b"] }));
    await stub.send(message("b", "hi"));
    await stub.send(message("a", "drop", { commitEpoch: 1, roster: ["a"] }));
    await stub.send(message("a", "after"));

    const page = await stub.list("b", 1, 10);
    expect("ok" in page && page.ok.messages.map((m) => m.seq)).toEqual([2, 3]);
    expect("ok" in page && page.ok.more).toBe(false);
    const short = await stub.list("b", 1, 1);
    expect("ok" in short && short.ok.more).toBe(true);
    expect(await stub.list("b", 3, 10)).toEqual({ error: "not_a_member" });

    // Back in, it reads everything again.
    await stub.send(message("a", "back", { commitEpoch: 2, roster: ["a", "b"] }));
    const all = await stub.list("b", 3, 10);
    expect("ok" in all && all.ok.messages.map((m) => m.seq)).toEqual([4, 5]);
  });

  it("keeps a Welcome for the accounts it is to, at its commit's seq", async () => {
    const { stub } = await created("a");
    await stub.send(message("a", "m1"));
    const welcome = { to: ["b"], message: bytes(9) };
    const sent = await stub.send(
      message("a", "add", { commitEpoch: 0, roster: ["a", "b", "c"], welcome }),
    );
    expect(sent).toEqual({ ok: { seq: 2 } });
    expect(await stub.welcome("b")).toEqual({ ok: { seq: 2, welcome: bytes(9) } });
    expect(await stub.welcome("c")).toEqual({ error: "not_found" });
    expect(await stub.welcome("a")).toEqual({ error: "not_found" });
  });

  it("refuses a Welcome for an account the claim leaves out", async () => {
    const { stub } = await created("a");
    const welcome = { to: ["b"], message: bytes(9) };
    expect(await stub.send(message("a", "add", { commitEpoch: 0, welcome }))).toEqual({
      error: "welcome_not_a_member",
    });
    // Refused whole: the epoch is still free.
    expect(await stub.send(message("a", "add2", { commitEpoch: 0 }))).toEqual({ ok: { seq: 1 } });
  });

  it("keeps the latest commit's GroupInfo for its members (0021)", async () => {
    const { stub } = await created("a");
    expect(await stub.groupInfo("a")).toEqual({ error: "not_found" });
    await stub.send(
      message("a", "c0", { commitEpoch: 0, roster: ["a", "b"], groupInfo: bytes(1) }),
    );
    await stub.send(message("a", "m1"));
    expect(await stub.groupInfo("b")).toEqual({ ok: { seq: 1, groupInfo: bytes(1) } });
    await stub.send(
      message("b", "c1", { commitEpoch: 1, roster: ["a", "b"], groupInfo: bytes(2) }),
    );
    expect(await stub.groupInfo("a")).toEqual({ ok: { seq: 3, groupInfo: bytes(2) } });
    // A commit that lost its epoch leaves the GroupInfo as it was.
    await stub.send(
      message("a", "c1b", { commitEpoch: 1, roster: ["a", "b"], groupInfo: bytes(3) }),
    );
    expect(await stub.groupInfo("a")).toEqual({ ok: { seq: 3, groupInfo: bytes(2) } });
    expect(await stub.groupInfo("x")).toEqual({ error: "not_a_member" });
  });

  it("takes an external commit that keeps the roster, after the epoch rule", async () => {
    const { stub } = await created("a");
    await stub.send(message("a", "c0", { commitEpoch: 0, roster: ["a", "b"] }));
    const external = (clientMsgId: string, commitEpoch: number, roster: string[]) =>
      message("b", clientMsgId, { commitEpoch, roster, external: true, groupInfo: bytes(5) });

    // On an old epoch it hears so first, even with a roster it may not set.
    expect(await stub.send(external("old", 0, ["b"]))).toEqual({ error: "epoch_conflict" });
    for (const roster of [["b"], ["a", "b", "c"], ["a", "c"]]) {
      expect(await stub.send(external(`r_${roster.join("")}`, 1, roster)), roster.join()).toEqual({
        error: "external_changes_roster",
      });
    }
    expect(await stub.send(external("join", 1, ["b", "a"]))).toEqual({ ok: { seq: 2 } });
    expect(await stub.groupInfo("a")).toEqual({ ok: { seq: 2, groupInfo: bytes(5) } });
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
    await stub.send(message("n_a", "add", { commitEpoch: 0, roster: ["n_a", "n_b", "n_c"] }));
    await stub.send(message("n_a", "drop", { commitEpoch: 1, roster: ["n_a", "n_b"] }));
    await stub.send(message("n_b", "hi"));
    await runDurableObjectAlarm(stub);
    expect(await inbox(testEnv, "n_a").latest()).toEqual({ [id]: 3 });
    expect(await inbox(testEnv, "n_b").latest()).toEqual({ [id]: 3 });
    expect(await inbox(testEnv, "n_c").latest()).toEqual({ [id]: 2 });
    await runInDurableObject(stub, (_, state) => {
      expect(state.storage.sql.exec("SELECT * FROM pending_notify").toArray()).toEqual([]);
    });
  });

  it("deletes messages and Welcomes 30 days after they were stored, not the GroupInfo", async () => {
    const { stub } = await created("a");
    const welcome = { to: ["b"], message: bytes(9) };
    const groupInfo = bytes(4);
    await stub.send(
      message("a", "add", { commitEpoch: 0, roster: ["a", "b"], welcome, groupInfo }),
    );
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
    // The GroupInfo stays: without it the conversation could not be joined.
    expect(await stub.groupInfo("b")).toEqual({ ok: { seq: 1, groupInfo } });
    // The next alarm waits for the newest message to expire.
    await runInDurableObject(stub, async (_, state) => {
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + RETENTION_MS - 60_000);
    });
  });

  it("drops commits whose messages expired, and still knows the next epoch", async () => {
    const { stub } = await created("a");
    await stub.send(message("a", "c0", { commitEpoch: 0 }));
    await stub.send(message("a", "c1", { commitEpoch: 1 }));
    await runInDurableObject(stub, (_, state) => {
      state.storage.sql.exec("UPDATE messages SET stored_at = ?", Date.now() - RETENTION_MS - 1);
    });
    await runDurableObjectAlarm(stub);
    const epochs = await runInDurableObject(stub, (_, state) =>
      state.storage.sql.exec<{ epoch: number }>("SELECT epoch FROM commits").toArray(),
    );
    expect(epochs).toEqual([{ epoch: 1 }]);
    expect(await stub.send(message("a", "c1b", { commitEpoch: 1 }))).toEqual({
      error: "epoch_conflict",
    });
    expect(await stub.send(message("a", "c2", { commitEpoch: 2 }))).toEqual({ ok: { seq: 3 } });
  });

  it("keeps a deleted account out of every later claim (0028)", async () => {
    const { stub } = await created("a");
    await stub.send(message("a", "add", { commitEpoch: 0, roster: ["a", "b"] }));
    await stub.removeAccount("b");
    expect(await stub.roster("a")).toEqual({ ok: ["a"] });

    // A commit on a stale epoch hears of its epoch first.
    expect(await stub.send(message("a", "old", { commitEpoch: 0, roster: ["a", "b"] }))).toEqual({
      error: "epoch_conflict",
    });
    expect(await stub.send(message("a", "back", { commitEpoch: 1, roster: ["a", "b"] }))).toEqual({
      error: "claim_names_departed",
    });
    expect(await stub.send(message("a", "fix", { commitEpoch: 1, roster: ["a"] }))).toEqual({
      ok: { seq: 2 },
    });
  });

  it("answers its roster to members only", async () => {
    const { stub } = await created("a");
    expect(await stub.roster("a")).toEqual({ ok: ["a"] });
    expect(await stub.roster("x")).toEqual({ error: "not_a_member" });
    expect(await conversation(testEnv, "conv_never").roster("a")).toEqual({ error: "not_found" });
  });

  it("is deleted whole when its last member's account is", async () => {
    const { id, stub } = await created("a");
    await stub.send(message("a", "m1"));
    await stub.removeAccount("a");
    expect(await stub.member("a")).toEqual({ error: "not_found" });
    expect(await stub.list("a", 0, 10)).toEqual({ error: "not_found" });
    await runInDurableObject(stub, async (_, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM messages").one().n).toBe(0);
    });
    const copy = await env.DB.prepare(
      "SELECT count(*) AS n FROM conversation_rosters WHERE conversation_id = ?",
    )
      .bind(id)
      .first<{ n: number }>();
    expect(copy?.n).toBe(0);
    // The id can be created afresh.
    expect(await stub.create("c", id)).toEqual({ ok: null });
  });
});
