import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { conversation } from "../src/env/index.ts";
import { deleteAccount } from "../src/accounts.ts";
import { expireMedia, MAX_CIPHERTEXT, MEDIA_RETENTION_MS } from "../src/media.ts";
import { device, euEnv } from "./support.ts";

// Photos and files (decision 0023): ciphertext in R2, bound to one
// conversation, readable by its roster only, gone after 30 days or with the
// account that sent it.

const BASE = "https://spjall.test";
const testEnv = euEnv(env);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;
type Device = Awaited<ReturnType<typeof device>>;

let made = 0;
const newId = () => `media${String(++made).padStart(17, "0")}`;

async function together(...members: Device[]) {
  const id = `media_conv_${++made}`;
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

const path = (conversationId: string, mediaId: string) =>
  `${BASE}/v1/conversations/${conversationId}/media/${mediaId}`;

const put = (by: Device, conversationId: string, mediaId: string, body: Uint8Array) =>
  exports.default.fetch(path(conversationId, mediaId), {
    method: "PUT",
    headers: { ...by.auth, "content-type": "application/octet-stream" },
    body,
  });

const get = (by: Device, conversationId: string, mediaId: string) =>
  exports.default.fetch(path(conversationId, mediaId), { headers: by.auth });

/** Random bytes; getRandomValues fills at most 64 KiB at a time. */
function bytes(n: number) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65_536) crypto.getRandomValues(out.subarray(i, i + 65_536));
  return out;
}

describe("media", () => {
  it("stores ciphertext for a member and hands it to another", async () => {
    const [alice, bob] = [await device(), await device()];
    const { id } = await together(alice, bob);
    const blob = bytes(70_000);
    const mediaId = newId();
    expect((await put(alice, id, mediaId, blob)).status).toBe(204);
    const fetched = await get(bob, id, mediaId);
    expect(fetched.status).toBe(200);
    expect(fetched.headers.get("content-length")).toBe(String(blob.length));
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(blob);
  });

  it("refuses a stranger both ways and a used id", async () => {
    const [alice, eve] = [await device(), await device()];
    const { id } = await together(alice);
    const mediaId = newId();
    const stranger = await put(eve, id, mediaId, bytes(10));
    expect(stranger.status).toBe(403);
    expect(await errorOf(stranger)).toBe("not_a_member");
    expect((await put(alice, id, mediaId, bytes(10))).status).toBe(204);
    expect((await get(eve, id, mediaId)).status).toBe(403);
    const again = await put(alice, id, mediaId, bytes(10));
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe("conflict");
  });

  it("binds an object to its conversation", async () => {
    const alice = await device();
    const first = await together(alice);
    const second = await together(alice);
    const mediaId = newId();
    await put(alice, first.id, mediaId, bytes(10));
    expect((await get(alice, second.id, mediaId)).status).toBe(404);
    expect((await get(alice, "media_conv_none", mediaId)).status).toBe(404);
  });

  it("stops a removed member fetching what was sent before", async () => {
    const [alice, bob] = [await device(), await device()];
    const { id, stub } = await together(alice, bob);
    const mediaId = newId();
    await put(alice, id, mediaId, bytes(10));
    await stub.send({
      account: alice.accountId,
      clientMsgId: "remove",
      ciphertext: Uint8Array.of(2),
      urgent: false,
      commitEpoch: 1,
      roster: [alice.accountId],
    });
    expect((await get(bob, id, mediaId)).status).toBe(403);
  });

  it("refuses more than 25 MB before reading the body", async () => {
    const alice = await device();
    const { id } = await together(alice);
    const response = await exports.default.fetch(path(id, newId()), {
      method: "PUT",
      headers: {
        ...alice.auth,
        "content-type": "application/octet-stream",
        "content-length": String(MAX_CIPHERTEXT + 1),
      },
      body: new ReadableStream({ start: (c) => (c.enqueue(bytes(1)), c.close()) }),
      duplex: "half",
    } as RequestInit);
    expect(response.status).toBe(413);
    expect(await errorOf(response)).toBe("too_large");
  });

  it("rejects a malformed id", async () => {
    const alice = await device();
    const { id } = await together(alice);
    expect((await put(alice, id, "short", bytes(10))).status).toBe(400);
  });

  it("expires objects after 30 days", async () => {
    const alice = await device();
    const { id } = await together(alice);
    const [old, fresh] = [newId(), newId()];
    await put(alice, id, old, bytes(10));
    await put(alice, id, fresh, bytes(10));
    await env.DB.prepare("UPDATE media SET created_at = ? WHERE media_id = ?")
      .bind(Date.now() - MEDIA_RETENTION_MS - 1, old)
      .run();
    expect(await expireMedia(testEnv)).toBe(1);
    expect(await env.MEDIA.head(old)).toBeNull();
    expect((await get(alice, id, old)).status).toBe(404);
    expect((await get(alice, id, fresh)).status).toBe(200);
  });

  it("deletes an account's uploads with the account", async () => {
    const [alice, bob] = [await device(), await device()];
    const { id } = await together(alice, bob);
    const [hers, his] = [newId(), newId()];
    await put(alice, id, hers, bytes(10));
    await put(bob, id, his, bytes(10));
    await deleteAccount(testEnv, alice.accountId);
    expect(await env.MEDIA.head(hers)).toBeNull();
    expect(await env.MEDIA.head(his)).not.toBeNull();
    const rows = await env.DB.prepare("SELECT media_id FROM media WHERE media_id IN (?, ?)")
      .bind(hers, his)
      .all();
    expect(rows.results).toEqual([{ media_id: his }]);
  });
});
