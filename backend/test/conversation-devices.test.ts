import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { conversation } from "../src/env/index.ts";
import { device, euEnv, revoke } from "./support.ts";
import { worker } from "./main.ts";

// The devices a member checks its group's leaves against (decision 0028):
// each roster account's active devices, shown to members only.

const BASE = "https://spjall.test";
const fetch = (path: string, auth: Record<string, string>) =>
  worker.fetch(`${BASE}${path}`, { headers: auth });
const testEnv = euEnv(env);
let made = 0;

type Device = Awaited<ReturnType<typeof device>>;

async function together(...members: Device[]) {
  const id = `devices_conv_${++made}`;
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
  return id;
}

const devicesOf = async (id: string, by: Device) => {
  const response = await fetch(`/v1/conversations/${id}/devices`, by.auth);
  return { status: response.status, body: (await response.json()) as unknown };
};

describe("a conversation's devices", () => {
  it("lists each roster account's active devices, and drops a revoked one", async () => {
    const phone = await device();
    const tablet = await device({ accountId: phone.accountId });
    const friend = await device();
    const id = await together(phone, friend);

    const sorted = [phone.deviceId, tablet.deviceId].sort();
    expect(await devicesOf(id, friend)).toEqual({
      status: 200,
      body: {
        accounts: [
          { accountId: phone.accountId, deviceIds: sorted },
          { accountId: friend.accountId, deviceIds: [friend.deviceId] },
        ],
      },
    });

    await revoke(tablet.deviceId);
    const { body } = await devicesOf(id, friend);
    expect(body).toEqual({
      accounts: [
        { accountId: phone.accountId, deviceIds: [phone.deviceId] },
        { accountId: friend.accountId, deviceIds: [friend.deviceId] },
      ],
    });
  });

  it("lists an account with no devices left with none", async () => {
    const friend = await device();
    const gone = await device();
    const id = await together(friend, gone);
    await revoke(gone.deviceId);
    const { body } = await devicesOf(id, friend);
    expect(body).toEqual({
      accounts: [
        { accountId: friend.accountId, deviceIds: [friend.deviceId] },
        { accountId: gone.accountId, deviceIds: [] },
      ],
    });
  });

  it("answers 403 to an account outside the conversation and 404 to none", async () => {
    const friend = await device();
    const stranger = await device();
    const id = await together(friend);
    expect(await devicesOf(id, stranger)).toEqual({
      status: 403,
      body: { error: "not_a_member", requestId: expect.any(String) },
    });
    expect((await devicesOf("devices_conv_never", friend)).status).toBe(404);
  });
});
