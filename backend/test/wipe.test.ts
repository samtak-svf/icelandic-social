import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import entry from "../src/index.ts";
import { conversation, inbox } from "../src/env/index.ts";
import { ACCOUNTS_PER_CALL, WIPE_PATH, type WipeResult } from "../src/wipe.ts";
import { runWipe } from "../scripts/wipe.ts";
import { invite } from "./oidc.ts";
import { device, euEnv } from "./support.ts";

// The one-off operator wipe (decision 0058): off without its secret, deaf to a
// wrong token, and with the right one, every account deleted through
// deleteAccount a batch at a time, then whatever no account owns, until every
// personal table and both buckets are empty.

const BASE = "https://spjall.test";
/** Built at runtime, so the file holds nothing that reads as a secret. */
const TOKEN = `wipe-${crypto.randomUUID()}`;
const eu = euEnv(env);
const armed = { ...eu, OPERATOR_WIPE_TOKEN: TOKEN } as Env;

const call = (target: Env, authorization?: string) =>
  entry.fetch(
    new Request(`${BASE}${WIPE_PATH}`, {
      method: "POST",
      headers: authorization ? { authorization } : {},
    }),
    target,
  );

async function count(sql: string) {
  return (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0;
}

/** Every table of the D1 database but the migrations' own and D1's internal ones. */
async function personalTables(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table'
       AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'`,
  ).all<{ name: string }>();
  return results.map((r) => r.name).sort();
}

type Seeded = Awaited<ReturnType<typeof device>>;

/** One account as a tester leaves it: devices, a KeyPackage, an identity, a photo, an invite. */
async function tester(): Promise<Seeded> {
  const phone = await device();
  const tablet = await device({ accountId: phone.accountId });
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO key_packages (device_id, key_package, created_at) VALUES (?, ?, ?)",
    ).bind(tablet.deviceId, Uint8Array.of(1, 2, 3), now),
    env.DB.prepare(
      "INSERT INTO identities (provider, subject_hmac, account_id, created_at) VALUES ('google', ?, ?, ?)",
    ).bind(crypto.randomUUID(), phone.accountId, now),
    env.DB.prepare(
      "UPDATE accounts SET display_name = ?, photo_version = ? WHERE account_id = ?",
    ).bind(`Prófun ${phone.accountId}`, crypto.randomUUID(), phone.accountId),
  ]);
  await invite({ inviter: phone.accountId });
  await env.PROFILES.put(phone.accountId, Uint8Array.of(9));
  return phone;
}

/** A conversation of `members` with a message and a photo in it, which the first one's inbox has heard of. */
async function talk(...members: Seeded[]): Promise<string> {
  const id = `c_${crypto.randomUUID()}`;
  const stub = conversation(eu, id);
  const [first] = members;
  await stub.create(first!.accountId, id);
  await stub.send({
    account: first!.accountId,
    clientMsgId: "add",
    ciphertext: Uint8Array.of(1),
    urgent: false,
    commitEpoch: 0,
    roster: members.map((m) => m.accountId),
  });
  await stub.send({
    account: first!.accountId,
    clientMsgId: "hello",
    ciphertext: Uint8Array.of(2, 3),
    urgent: true,
  });
  const mediaId = `m_${crypto.randomUUID()}`;
  await env.DB.prepare(
    `INSERT INTO media (media_id, conversation_id, uploader_account_id, size, created_at)
     VALUES (?, ?, ?, 3, ?)`,
  )
    .bind(mediaId, id, first!.accountId, Date.now())
    .run();
  await env.MEDIA.put(mediaId, Uint8Array.of(4, 5, 6));
  await inbox(eu, first!.accountId).notify(first!.accountId, id, 2, 2);
  return id;
}

const stored = (id: string) =>
  runInDurableObject(
    conversation(eu, id),
    (_, state) => state.storage.sql.exec<{ n: number }>("SELECT count(*) AS n FROM meta").one().n,
  );

describe("the operator wipe", () => {
  it("is off while its secret is unset: 404, and nothing is deleted", async () => {
    const someone = await device();
    const response = await call(eu, `Bearer ${TOKEN}`);
    expect(response.status).toBe(404);
    expect(
      await count(`SELECT count(*) AS n FROM accounts WHERE account_id = '${someone.accountId}'`),
    ).toBe(1);
  });

  it("answers a wrong or missing token like a path that does not exist", async () => {
    for (const authorization of [
      undefined,
      `Bearer ${TOKEN}x`,
      `Bearer ${TOKEN.slice(1)}`,
      TOKEN,
    ]) {
      const response = await call(armed, authorization);
      expect(response.status).toBe(404);
      expect(((await response.json()) as { error: string }).error).toBe("not_found");
    }
    expect(await count("SELECT count(*) AS n FROM accounts")).toBeGreaterThan(0);
  });

  it("deletes every account a batch at a time, then every leftover, until nothing is left", async () => {
    const testers: Seeded[] = [];
    for (let i = 0; i < 2 * ACCOUNTS_PER_CALL + 3; i++) testers.push(await tester());
    const conversations: string[] = [];
    for (let i = 0; i + 1 < testers.length; i += 2) {
      conversations.push(await talk(testers[i]!, testers[i + 1]!));
    }
    conversations.push(await talk(...testers.slice(0, 5)));
    await env.DB.prepare(
      "INSERT INTO blocks (blocker_account_id, blocked_account_id, created_at) VALUES (?, ?, ?)",
    )
      .bind(testers[0]!.accountId, testers[1]!.accountId, Date.now())
      .run();
    // What deleteAccount never reaches: an operator invite, a roster copy
    // whose conversation outlived its members' copies, and objects no row names.
    await invite({ singleUse: true });
    const stray = `c_${crypto.randomUUID()}`;
    await conversation(eu, stray).create(testers[0]!.accountId, stray);
    await env.DB.prepare("DELETE FROM conversation_members WHERE conversation_id = ?")
      .bind(stray)
      .run();
    await env.MEDIA.put(`m_${crypto.randomUUID()}`, Uint8Array.of(7));
    await env.PROFILES.put(`gone_${crypto.randomUUID()}`, Uint8Array.of(8));

    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const results: WipeResult[] = [];
    const total = await runWipe(
      async () => {
        const response = await call(armed, `Bearer ${TOKEN}`);
        expect(response.status).toBe(200);
        const result = (await response.json()) as WipeResult;
        results.push(result);
        return result;
      },
      () => {},
    );

    const accounts = await count("SELECT count(*) AS n FROM accounts");
    expect(accounts).toBe(0);
    expect(total).toBeGreaterThanOrEqual(testers.length);
    expect(results.length).toBeGreaterThanOrEqual(3);
    expect(results.every((r) => r.deleted <= ACCOUNTS_PER_CALL)).toBe(true);
    expect(results.at(-1)).toEqual({ deleted: expect.any(Number), remaining: 0, leftovers: 0 });

    for (const table of await personalTables()) {
      expect(await count(`SELECT count(*) AS n FROM ${table}`), table).toBe(0);
    }
    for (const bucket of [env.MEDIA, env.PROFILES]) {
      expect((await bucket.list()).objects).toEqual([]);
    }
    for (const id of [...conversations, stray]) expect(await stored(id), id).toBe(0);
    for (const t of testers) expect(await inbox(eu, t.accountId).latest()).toEqual({});

    // Counts only, never an id (decision 0008).
    const lines = logged.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((line) => line.event === "operator.wiped");
    expect(lines).toHaveLength(results.length);
    for (const line of lines)
      expect(Object.keys(line).sort()).toEqual(["count", "event", "requestId"]);

    // A call after the end deletes nothing and finds nothing.
    const again = await call(armed, `Bearer ${TOKEN}`);
    expect(await again.json()).toEqual({ deleted: 0, remaining: 0, leftovers: 0 });
  });
});

describe("the wipe script", () => {
  it("stops when a call makes no progress", async () => {
    const stuck = async () => ({ deleted: 0, remaining: 1, leftovers: 0 });
    await expect(runWipe(stuck, () => {})).rejects.toThrow(/no progress/);
  });
});
