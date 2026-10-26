import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { conversation } from "../../../src/env/index.ts";
import { device, euEnv } from "../../support.ts";
import { worker } from "../../main.ts";

// Leaving a group (decision 0078): the leaver stays in the roster until a
// member's commit removes its leaves; until then the devices listing leaves
// it out and no claim may keep it.

const BASE = "https://spjall.test";
const testEnv = euEnv(env);
let made = 0;

type Device = Awaited<ReturnType<typeof device>>;

const call = (method: string, path: string, by: Device) =>
  worker.fetch(`${BASE}${path}`, { method, headers: by.auth });

let epoch = 0;
const commit = (id: string, by: Device, roster: Device[], commitEpoch: number) =>
  conversation(testEnv, id).send({
    account: by.accountId,
    clientMsgId: `commit_${++epoch}`,
    ciphertext: Uint8Array.of(1),
    urgent: false,
    commitEpoch,
    roster: roster.map((m) => m.accountId),
  });

async function group(...members: Device[]) {
  const id = `leave_conv_${++made}`;
  await conversation(testEnv, id).create(members[0]!.accountId, id);
  await commit(id, members[0]!, members, 0);
  return id;
}

const listed = async (id: string, by: Device) => {
  const response = await call("GET", `/v1/conversations/${id}/devices`, by);
  const body = (await response.json()) as { accounts: { accountId: string }[] };
  return body.accounts.map((a) => a.accountId).sort();
};

describe("leaving a conversation", () => {
  it("answers 204, again too, and the devices listing leaves the leaver out", async () => {
    const [a, b, c] = [await device(), await device(), await device()];
    const id = await group(a, b, c);
    expect((await call("POST", `/v1/conversations/${id}/leave`, c)).status).toBe(204);
    expect((await call("POST", `/v1/conversations/${id}/leave`, c)).status).toBe(204);
    expect(await listed(id, a)).toEqual([a.accountId, b.accountId].sort());
  });

  it("keeps the leaver reading the history until a commit removes it", async () => {
    const [a, b, c] = [await device(), await device(), await device()];
    const id = await group(a, b, c);
    await call("POST", `/v1/conversations/${id}/leave`, c);
    const page = await call("GET", `/v1/conversations/${id}/messages?after=0`, c);
    expect(page.status).toBe(200);
  });

  it("refuses a claim that keeps the leaver, takes one that removes it, then one that adds it back", async () => {
    const [a, b, c] = [await device(), await device(), await device()];
    const id = await group(a, b, c);
    await call("POST", `/v1/conversations/${id}/leave`, c);
    expect(await commit(id, a, [a, b, c], 1)).toEqual({ error: "claim_names_departed" });
    expect(await commit(id, a, [a, b], 1)).toEqual({ ok: { seq: expect.any(Number) } });
    expect(await commit(id, b, [a, b, c], 2)).toEqual({ ok: { seq: expect.any(Number) } });
    expect(await listed(id, a)).toEqual([a.accountId, b.accountId, c.accountId].sort());
  });

  it("answers 403 to an account outside the conversation and 404 to none", async () => {
    const [a, stranger] = [await device(), await device()];
    const id = await group(a);
    const refused = await call("POST", `/v1/conversations/${id}/leave`, stranger);
    expect(refused.status).toBe(403);
    expect((await call("POST", "/v1/conversations/leave_conv_never/leave", a)).status).toBe(404);
  });
});
