import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { conversation, inbox } from "../src/env/index.ts";
import { invite, signIn } from "./kenni.ts";
import { connect } from "./socket.ts";
import { device, euEnv } from "./support.ts";
import { worker } from "./main.ts";

// The end of a device and of an account (decision 0019): a revoked token
// fails at once and its socket closes; a deleted account leaves no roster
// entry, no inbox, no rows and no working invite behind.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;
const remove = (path: string, auth: Record<string, string>) =>
  fetch(path, { method: "DELETE", headers: auth });

/** The 4401 a socket closes with when its device or account ends. */
const REVOKED = 4401;

async function stockKeyPackage(deviceId: string) {
  await env.DB.prepare(
    "INSERT INTO key_packages (device_id, key_package, created_at) VALUES (?, ?, ?)",
  )
    .bind(deviceId, new Uint8Array([1, 2, 3]), Date.now())
    .run();
}

async function count(sql: string, ...values: unknown[]) {
  const row = await env.DB.prepare(sql)
    .bind(...values)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

describe("revoking a device", () => {
  it("kills its token at once, deletes its KeyPackages and closes its socket", async () => {
    const phone = await device();
    const tablet = await device({ accountId: phone.accountId });
    await stockKeyPackage(tablet.deviceId);
    const socket = await connect(tablet.auth);
    expect((await socket.next()).type).toBe("hello");

    expect((await remove(`/v1/devices/${tablet.deviceId}`, phone.auth)).status).toBe(204);

    expect((await socket.closed).code).toBe(REVOKED);
    expect((await fetch("/v1/me", { headers: tablet.auth })).status).toBe(401);
    expect(
      await count("SELECT count(*) AS n FROM key_packages WHERE device_id = ?", tablet.deviceId),
    ).toBe(0);
    const me = (await (await fetch("/v1/me", { headers: phone.auth })).json()) as {
      devices: { deviceId: string }[];
    };
    expect(me.devices.map((d) => d.deviceId)).toEqual([phone.deviceId]);
  });

  it("lets a device revoke itself, which is signing out", async () => {
    const phone = await device();
    expect((await remove(`/v1/devices/${phone.deviceId}`, phone.auth)).status).toBe(204);
    expect((await fetch("/v1/me", { headers: phone.auth })).status).toBe(401);
  });

  it("answers 404 for another account's device and leaves it working", async () => {
    const mine = await device();
    const theirs = await device();
    const response = await remove(`/v1/devices/${theirs.deviceId}`, mine.auth);
    expect(response.status).toBe(404);
    expect(await errorOf(response)).toBe("not_found");
    expect((await fetch("/v1/me", { headers: theirs.auth })).status).toBe(200);
  });

  it("answers 404 for a device already revoked", async () => {
    const phone = await device();
    const tablet = await device({ accountId: phone.accountId });
    expect((await remove(`/v1/devices/${tablet.deviceId}`, phone.auth)).status).toBe(204);
    expect((await remove(`/v1/devices/${tablet.deviceId}`, phone.auth)).status).toBe(404);
  });
});

describe("deleting an account", () => {
  it("revokes every token, leaves the rosters, wipes the inbox and deletes the rows", async () => {
    const response = await signIn({ inviteToken: await invite({ singleUse: true }) });
    expect(response.status).toBe(200);
    const signedIn = (await response.json()) as {
      accountId: string;
      deviceId: string;
      token: string;
    };
    const phone = { ...signedIn, auth: { authorization: `Bearer ${signedIn.token}` } };
    const tablet = await device({ accountId: phone.accountId });
    await stockKeyPackage(tablet.deviceId);

    // A conversation with a friend, which the inbox has been told of.
    const friend = await device();
    const conversationId = `c_${crypto.randomUUID()}`;
    const eu = euEnv(env);
    await conversation(eu, conversationId).create(phone.accountId, conversationId);
    await runInDurableObject(conversation(eu, conversationId), (_, state) => {
      state.storage.sql.exec("INSERT INTO roster (account) VALUES (?)", friend.accountId);
    });
    await inbox(eu, phone.accountId).notify(phone.accountId, conversationId, 1, 1);

    // Someone this account let in, and its live invite.
    const rotated = await fetch("/v1/me/invite", { method: "POST", headers: phone.auth });
    const { token: link } = (await rotated.json()) as { token: string };
    const invitee = await signIn({ inviteToken: link });
    const { accountId: inviteeId } = (await invitee.json()) as { accountId: string };

    const socket = await connect(tablet.auth);
    expect((await socket.next()).type).toBe("hello");

    expect((await remove("/v1/me", phone.auth)).status).toBe(204);

    expect((await socket.closed).code).toBe(REVOKED);
    for (const auth of [phone.auth, tablet.auth]) {
      expect((await fetch("/v1/me", { headers: auth })).status).toBe(401);
    }
    const roster = await runInDurableObject(conversation(eu, conversationId), (_, state) =>
      state.storage.sql.exec<{ account: string }>("SELECT account FROM roster").toArray(),
    );
    expect(roster.map((r) => r.account)).toEqual([friend.accountId]);
    expect(await inbox(eu, phone.accountId).latest()).toEqual({});

    const id = phone.accountId;
    expect(await count("SELECT count(*) AS n FROM accounts WHERE account_id = ?", id)).toBe(0);
    expect(await count("SELECT count(*) AS n FROM devices WHERE account_id = ?", id)).toBe(0);
    expect(
      await count("SELECT count(*) AS n FROM key_packages WHERE device_id = ?", tablet.deviceId),
    ).toBe(0);
    expect(await count("SELECT count(*) AS n FROM invites WHERE inviter_account_id = ?", id)).toBe(
      0,
    );
    expect((await fetch(`/v1/invites/${link}`)).status).toBe(404);
    const invited = await env.DB.prepare("SELECT invited_by FROM accounts WHERE account_id = ?")
      .bind(inviteeId)
      .first<{ invited_by: string | null }>();
    expect(invited).toEqual({ invited_by: null });
  });

  it("reaches a conversation its inbox never listed", async () => {
    const phone = await device();
    const friend = await device();
    const conversationId = `c_${crypto.randomUUID()}`;
    const eu = euEnv(env);
    const stub = conversation(eu, conversationId);
    await stub.create(friend.accountId, conversationId);
    await stub.send({
      account: friend.accountId,
      clientMsgId: "add",
      ciphertext: Uint8Array.of(1),
      urgent: false,
      commitEpoch: 0,
      roster: [friend.accountId, phone.accountId],
    });
    // The notification never reached the inbox: only the roster copy in D1
    // knows of the conversation.
    await runInDurableObject(stub, async (_, state) => {
      await state.storage.deleteAlarm();
      state.storage.sql.exec("DELETE FROM pending_notify");
    });
    await inbox(eu, phone.accountId).wipe();
    expect(await inbox(eu, phone.accountId).latest()).toEqual({});
    expect(await stub.roster(friend.accountId)).toEqual({
      ok: [friend.accountId, phone.accountId],
    });

    expect((await remove("/v1/me", phone.auth)).status).toBe(204);
    expect(await stub.roster(friend.accountId)).toEqual({ ok: [friend.accountId] });
  });

  it("leaves an inbox that still takes a late notify", async () => {
    const phone = await device();
    expect((await remove("/v1/me", phone.auth)).status).toBe(204);
    const box = inbox(euEnv(env), phone.accountId);
    await box.notify(phone.accountId, "c_late", 3, 3);
    expect(await box.latest()).toEqual({ c_late: 3 });
  });
});
