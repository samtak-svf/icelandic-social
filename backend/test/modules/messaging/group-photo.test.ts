import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../src/api/common.ts";
import { conversation } from "../../../src/env/index.ts";
import { deleteAccount } from "../../../src/compose/account-deletion.ts";
import { device, euEnv } from "../../support.ts";
import { worker } from "../../main.ts";

// A group photo (decision 0094): ciphertext in the profiles bucket under
// groups/<conversationId>/<mediaId>, one per conversation, readable by the roster.

const BASE = "https://spjall.test";
const testEnv = euEnv(env);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;
type Device = Awaited<ReturnType<typeof device>>;

let made = 0;
const newId = () => `photo${String(++made).padStart(17, "0")}`;

async function together(...members: Device[]) {
  const id = `gphoto_conv_${++made}`;
  const stub = conversation(testEnv, id);
  await stub.create(members[0]!.accountId, id);
  await stub.send({
    account: members[0]!.accountId,
    clientMsgId: "add",
    ciphertext: Uint8Array.of(1),
    urgent: false,
    commitEpoch: 0,
    roster: members.map((m) => m.accountId),
  });
  return { id, stub };
}

const key = (conversationId: string, mediaId: string) => `groups/${conversationId}/${mediaId}`;

const put = (by: Device, conversationId: string, mediaId: string, body: Uint8Array) =>
  worker.fetch(`${BASE}/v1/conversations/${conversationId}/photo/${mediaId}`, {
    method: "PUT",
    headers: { ...by.auth, "content-type": "application/octet-stream" },
    body,
  });

const get = (by: Device, conversationId: string, mediaId: string) =>
  worker.fetch(`${BASE}/v1/conversations/${conversationId}/photo/${mediaId}`, {
    headers: by.auth,
  });

const clear = (by: Device, conversationId: string) =>
  worker.fetch(`${BASE}/v1/conversations/${conversationId}/photo`, {
    method: "DELETE",
    headers: by.auth,
  });

const rows = async (conversationId: string) =>
  (
    await env.DB.prepare("SELECT media_id, size FROM group_photos WHERE conversation_id = ?")
      .bind(conversationId)
      .all<{ media_id: string; size: number }>()
  ).results;

function bytes(n: number) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65_536) crypto.getRandomValues(out.subarray(i, i + 65_536));
  return out;
}

describe("group photo", () => {
  it("stores ciphertext for a member and hands it to another", async () => {
    const [alice, bob] = [await device(), await device()];
    const { id } = await together(alice, bob);
    const blob = bytes(40_000);
    const mediaId = newId();
    expect((await put(alice, id, mediaId, blob)).status).toBe(204);
    expect(await rows(id)).toEqual([{ media_id: mediaId, size: blob.length }]);
    expect(await env.PROFILES.head(key(id, mediaId))).not.toBeNull();
    const fetched = await get(bob, id, mediaId);
    expect(fetched.status).toBe(200);
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(blob);
  });

  it("refuses a stranger both ways and answers 404 for an absent object", async () => {
    const [alice, eve] = [await device(), await device()];
    const { id } = await together(alice);
    const mediaId = newId();
    const refused = await put(eve, id, mediaId, bytes(10));
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("not_a_member");
    expect(await env.PROFILES.head(key(id, mediaId))).toBeNull();
    expect((await get(alice, id, mediaId)).status).toBe(404);
    await put(alice, id, mediaId, bytes(10));
    const stranger = await get(eve, id, mediaId);
    expect(stranger.status).toBe(403);
    expect(await errorOf(stranger)).toBe("not_a_member");
  });

  it("refuses more than 1 MB", async () => {
    const alice = await device();
    const { id } = await together(alice);
    const response = await put(alice, id, newId(), bytes(1_048_576 + 1));
    expect(response.status).toBe(413);
    expect(await rows(id)).toEqual([]);
    expect((await put(alice, id, newId(), bytes(1_048_576))).status).toBe(204);
  });

  it("deletes the old object when a new one replaces it", async () => {
    const [alice, bob] = [await device(), await device()];
    const { id } = await together(alice, bob);
    const [first, second] = [newId(), newId()];
    await put(alice, id, first, bytes(10));
    expect((await put(bob, id, second, bytes(20))).status).toBe(204);
    expect(await env.PROFILES.head(key(id, first))).toBeNull();
    expect(await env.PROFILES.head(key(id, second))).not.toBeNull();
    expect(await rows(id)).toEqual([{ media_id: second, size: 20 }]);
    expect((await get(alice, id, first)).status).toBe(404);
  });

  it("clears the row and the object, again too", async () => {
    const [alice, eve] = [await device(), await device()];
    const { id } = await together(alice);
    const mediaId = newId();
    await put(alice, id, mediaId, bytes(10));
    expect((await clear(eve, id)).status).toBe(403);
    expect(await rows(id)).toHaveLength(1);
    expect((await clear(alice, id)).status).toBe(204);
    expect(await rows(id)).toEqual([]);
    expect(await env.PROFILES.head(key(id, mediaId))).toBeNull();
    expect((await clear(alice, id)).status).toBe(204);
  });

  it("is deleted when the last member leaves, and not when another account is deleted", async () => {
    const [alice, bob] = [await device(), await device()];
    const { id } = await together(alice, bob);
    const mediaId = newId();
    await put(alice, id, mediaId, bytes(10));
    await deleteAccount(testEnv, alice.accountId);
    expect(await rows(id)).toHaveLength(1);
    expect(await env.PROFILES.head(key(id, mediaId))).not.toBeNull();
    await deleteAccount(testEnv, bob.accountId);
    expect(await rows(id)).toEqual([]);
    expect(await env.PROFILES.head(key(id, mediaId))).toBeNull();
  });
});
