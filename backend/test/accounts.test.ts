import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { base64url } from "../src/bytes.ts";
import { conversation } from "../src/env/index.ts";
import { copyRoster } from "../src/profiles.ts";
import { hexBytes, mls } from "./mls.ts";
import { device, euEnv } from "./support.ts";
import { worker } from "./main.ts";

// Other accounts' names (decisions 0022, 0034) and block (decision 0024):
// any signed-in account reads any account's name and mark; the Conversation
// DO's roster copy in D1 follows its commits; a blocked account cannot claim
// the blocker's KeyPackages or bring the blocker into a group.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const send = (method: string, path: string, auth: Record<string, string>, body?: unknown) =>
  fetch(path, {
    method,
    headers: { "content-type": "application/json", ...auth },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

const testEnv = euEnv(env);
type Device = Awaited<ReturnType<typeof device>>;

async function named(name: string) {
  const seeded = await device();
  await env.DB.prepare("UPDATE accounts SET display_name = ?, verified = 1 WHERE account_id = ?")
    .bind(name, seeded.accountId)
    .run();
  return seeded;
}

let made = 0;

/** A conversation whose roster is `members`, made through the DO as the Worker would. */
async function together(...members: Device[]) {
  const id = `conv_${++made}`;
  const stub = conversation(testEnv, id);
  const [creator] = members;
  await stub.create(creator!.accountId, id);
  await stub.send({
    account: creator!.accountId,
    clientMsgId: "add",
    ciphertext: Uint8Array.of(1),
    urgent: false,
    commitEpoch: 0,
    roster: members.map((m) => m.accountId),
  });
  return {
    id,
    stub,
    /** A commit leaving the roster as `after`. */
    commit: (epoch: number, after: Device[]) =>
      stub.send({
        account: creator!.accountId,
        clientMsgId: `c${epoch}`,
        ciphertext: Uint8Array.of(2),
        urgent: false,
        commitEpoch: epoch,
        roster: after.map((m) => m.accountId),
      }),
  };
}

const profileOf = (accountId: string, by: Device) =>
  fetch(`/v1/accounts/${accountId}`, { headers: by.auth });

/** The accounts D1's roster copy holds for a conversation. */
async function copied(conversationId: string) {
  const { results } = await env.DB.prepare(
    "SELECT account_id AS id FROM conversation_members WHERE conversation_id = ? ORDER BY id",
  )
    .bind(conversationId)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

describe("GET /v1/accounts/{accountId}", () => {
  it("names an account that shares a conversation", async () => {
    const [alice, bob] = [await named("Alísa Prófsdóttir"), await named("Bjarni Prófsson")];
    await together(alice, bob);
    const response = await profileOf(bob.accountId, alice);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: bob.accountId,
      name: "Bjarni Prófsson",
      verified: true,
      photo: null,
    });
  });

  it("names a stranger too: everyone signed in is in the directory (decisions 0034, 0036)", async () => {
    const [alice, stranger] = [
      await named("Alísa Prófsdóttir"),
      await named("Ókunnug Prófsdóttir"),
    ];
    const response = await profileOf(stranger.accountId, alice);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: stranger.accountId,
      name: "Ókunnug Prófsdóttir",
      verified: true,
      photo: null,
    });
  });

  it("answers no account at all with 404", async () => {
    const alice = await named("Alísa Prófsdóttir");
    const response = await profileOf("acct_none", alice);
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("not_found");
  });

  it("names the caller's own account", async () => {
    const alice = await named("Alísa Prófsdóttir");
    expect((await profileOf(alice.accountId, alice)).status).toBe(200);
  });

  it("needs a device token", async () => {
    expect((await fetch("/v1/accounts/acct_1")).status).toBe(401);
  });
});

describe("the roster copy in D1", () => {
  it("drops an account once a commit leaves it out", async () => {
    const [alice, bob, carol] = [await named("A"), await named("B"), await named("C")];
    const { id, commit } = await together(alice, bob, carol);
    expect(await copied(id)).toEqual([alice, bob, carol].map((d) => d.accountId).sort());
    await commit(1, [alice, bob]);
    expect(await copied(id)).toEqual([alice, bob].map((d) => d.accountId).sort());
  });

  it("keeps the newest roster when an older copy arrives late", async () => {
    const [alice, bob] = [await named("A"), await named("B")];
    const { id, stub, commit } = await together(alice, bob);
    await commit(1, [alice]);
    // The alarm finds nothing left to copy, and a copy of the commit at
    // seq 1 that arrives after the one at seq 2 changes nothing.
    await runDurableObjectAlarm(stub);
    await copyRoster(env, id, 1, [alice.accountId, bob.accountId]);
    expect(await copied(id)).toEqual([alice.accountId]);
  });
});

async function stock(owner: Device) {
  const response = await send("POST", "/v1/key-packages", owner.auth, {
    keyPackages: [owner.keyPackage, owner.keyPackage],
  });
  expect(response.status).toBe(200);
}

const claim = (accountId: string, by: Device) =>
  send("POST", `/v1/accounts/${accountId}/key-packages`, by.auth, {});

describe("block", () => {
  it("stops the blocked account claiming the blocker's KeyPackages, until lifted", async () => {
    const [alice, bob] = [await named("A"), await named("B")];
    await stock(alice);
    await stock(bob);
    expect((await send("PUT", `/v1/blocks/${bob.accountId}`, alice.auth)).status).toBe(204);
    expect((await send("PUT", `/v1/blocks/${bob.accountId}`, alice.auth)).status).toBe(204);

    const refused = await claim(alice.accountId, bob);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("blocked");
    // One way only: alice can still reach bob.
    expect((await claim(bob.accountId, alice)).status).toBe(200);

    expect((await send("DELETE", `/v1/blocks/${bob.accountId}`, alice.auth)).status).toBe(204);
    expect((await claim(alice.accountId, bob)).status).toBe(200);
    expect((await send("DELETE", `/v1/blocks/${bob.accountId}`, alice.auth)).status).toBe(204);
  });

  it("lists the blocked accounts with their names, newest first", async () => {
    const [alice, bob, carol] = [await named("A"), await named("B"), await named("C")];
    await send("PUT", `/v1/blocks/${bob.accountId}`, alice.auth);
    await send("PUT", `/v1/blocks/${carol.accountId}`, alice.auth);
    const response = await fetch("/v1/blocks", { headers: alice.auth });
    expect(response.status).toBe(200);
    const { blocked } = (await response.json()) as { blocked: { accountId: string }[] };
    expect(blocked.map((b) => b.accountId).sort()).toEqual([bob.accountId, carol.accountId].sort());
    expect(blocked[0]).toEqual({
      accountId: expect.any(String),
      name: expect.any(String),
      verified: true,
      blockedAt: expect.any(Number),
    });
    expect(await (await fetch("/v1/blocks", { headers: bob.auth })).json()).toEqual({
      blocked: [],
    });
  });

  it("refuses the caller's own account and one that does not exist", async () => {
    const alice = await named("A");
    const own = await send("PUT", `/v1/blocks/${alice.accountId}`, alice.auth);
    expect(own.status).toBe(400);
    const none = await send("PUT", "/v1/blocks/acct_none", alice.auth);
    expect(none.status).toBe(404);
  });

  it("refuses a commit that brings in an account that has blocked its sender", async () => {
    const [a, b] = [await device(), await device()];
    const id = base64url(hexBytes(mls.messages[0]!.groupId));
    expect((await send("POST", "/v1/conversations", a.auth, { conversationId: id })).status).toBe(
      200,
    );
    await send("PUT", `/v1/blocks/${a.accountId}`, b.auth);
    const add = {
      clientMsgId: "add_b",
      ciphertext: mls.claimed("add b", [a.accountId, b.accountId], [b.accountId]),
      welcome: { message: mls.welcomeBase64 },
      groupInfo: mls.groupInfo("add b"),
    };
    const refused = await send("POST", `/v1/conversations/${id}/messages`, a.auth, add);
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("blocked");

    await send("DELETE", `/v1/blocks/${a.accountId}`, b.auth);
    expect((await send("POST", `/v1/conversations/${id}/messages`, a.auth, add)).status).toBe(200);
  });
});
