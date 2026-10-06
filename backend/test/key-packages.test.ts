import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { device, revoke } from "./support.ts";
import { hexBytes, mls } from "./mls.ts";

// KeyPackages in D1 (decisions 0017, 0018): uploaded per device and naming
// it, claimed one per active device of an account but the caller's, the last
// resort never consumed.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => exports.default.fetch(`${BASE}${path}`, init);
const post = (path: string, body: unknown, auth: Record<string, string>) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(body),
  });
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

type Device = Awaited<ReturnType<typeof device>>;

async function upload(owner: Device, body: { keyPackages: string[]; lastResort?: string }) {
  return post("/v1/key-packages", body, owner.auth);
}

async function claim(accountId: string, by: Device) {
  const response = await post(`/v1/accounts/${accountId}/key-packages`, {}, by.auth);
  return { response, body: response.ok ? ((await response.json()) as Claimed) : null };
}

type Claimed = { keyPackages: { deviceId: string; keyPackage: string }[] };

async function held(deviceId: string) {
  const row = await env.DB.prepare(
    "SELECT sum(last_resort = 0) AS packages, sum(last_resort = 1) AS lastResort FROM key_packages WHERE device_id = ?",
  )
    .bind(deviceId)
    .first<{ packages: number | null; lastResort: number | null }>();
  return { packages: row?.packages ?? 0, lastResort: row?.lastResort ?? 0 };
}

describe("uploading KeyPackages", () => {
  it("stores them and answers how many the device holds", async () => {
    const owner = await device();
    let response = await upload(owner, { keyPackages: [owner.keyPackage, owner.keyPackage] });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: 2 });

    response = await upload(owner, { keyPackages: [owner.keyPackage] });
    expect(await response.json()).toEqual({ available: 3 });
  });

  it("does not count the last resort as available, and replaces it", async () => {
    const owner = await device();
    let response = await upload(owner, { keyPackages: [], lastResort: owner.keyPackage });
    expect(await response.json()).toEqual({ available: 0 });
    response = await upload(owner, { keyPackages: [], lastResort: owner.keyPackage });
    expect(await response.json()).toEqual({ available: 0 });
    expect(await held(owner.deviceId)).toEqual({ packages: 0, lastResort: 1 });
  });

  it("takes a KeyPackage OpenMLS made for the device, credential and key", async () => {
    const { accountId, deviceId, devicePublic } = mls.keyPackage;
    const owner = await device({ accountId, deviceId, deviceKey: hexBytes(devicePublic) });
    const response = await upload(owner, { keyPackages: [mls.keyPackageBase64] });
    expect(await response.json()).toEqual({ available: 1 });
  });

  it.each<[string, (owner: Device) => string]>([
    ["a Welcome", () => mls.welcomeBase64],
    ["a commit", () => mls.base64("add b")],
    ["bytes that are not MLS", () => toBase64(new Uint8Array([1, 2, 3]))],
    [
      "a KeyPackage in another cipher suite",
      (owner) => {
        const bytes = Uint8Array.from(atob(owner.keyPackage), (c) => c.charCodeAt(0));
        bytes[7] = 0x02;
        return toBase64(bytes);
      },
    ],
    [
      "a KeyPackage naming another account",
      (owner) => mls.keyPackageNaming(`acct_other/${owner.deviceId}`, owner.deviceKey),
    ],
    [
      "a KeyPackage naming another device of the account",
      (owner) => mls.keyPackageNaming(`${owner.accountId}/dev_other`, owner.deviceKey),
    ],
    [
      "a KeyPackage under a key the device did not register",
      (owner) =>
        mls.keyPackageNaming(
          `${owner.accountId}/${owner.deviceId}`,
          owner.deviceKey.map((b) => b ^ 1),
        ),
    ],
    ["another device's KeyPackage, as OpenMLS made it", () => mls.keyPackageBase64],
  ])("refuses %s, and stores nothing from that upload", async (_, make) => {
    const owner = await device();
    const refused = make(owner);
    for (const body of [
      { keyPackages: [owner.keyPackage, refused] },
      { keyPackages: [owner.keyPackage], lastResort: refused },
    ]) {
      const response = await upload(owner, body);
      expect(response.status).toBe(400);
      expect(await errorOf(response)).toBe("invalid_request");
    }
    expect(await held(owner.deviceId)).toEqual({ packages: 0, lastResort: 0 });
  });

  it("refuses an upload that would leave more than 100 held", async () => {
    const owner = await device();
    const response = await upload(owner, { keyPackages: Array(100).fill(owner.keyPackage) });
    expect(await response.json()).toEqual({ available: 100 });

    const over = await upload(owner, { keyPackages: [owner.keyPackage] });
    expect(over.status).toBe(400);
    expect(await held(owner.deviceId)).toEqual({ packages: 100, lastResort: 0 });
  });
});

describe("claiming KeyPackages", () => {
  it("hands out one per active device, each consumed once", async () => {
    const phone = await device();
    const tablet = await device({ accountId: phone.accountId });
    const claimer = await device();
    await upload(phone, { keyPackages: [phone.keyPackage] });
    await upload(tablet, { keyPackages: [tablet.keyPackage, tablet.keyPackage] });

    const first = await claim(phone.accountId, claimer);
    expect(first.response.status).toBe(200);
    expect(first.body!.keyPackages).toEqual(
      [phone, tablet]
        .sort((x, y) => x.deviceId.localeCompare(y.deviceId))
        .map(({ deviceId, keyPackage }) => ({ deviceId, keyPackage })),
    );
    expect(await held(phone.deviceId)).toEqual({ packages: 0, lastResort: 0 });
    expect(await held(tablet.deviceId)).toEqual({ packages: 1, lastResort: 0 });

    // The phone has nothing left and no last resort, so only the tablet answers.
    const second = await claim(phone.accountId, claimer);
    expect(second.body!.keyPackages.map((p) => p.deviceId)).toEqual([tablet.deviceId]);
    expect(await held(tablet.deviceId)).toEqual({ packages: 0, lastResort: 0 });
  });

  it("gives the last resort only when nothing else is left, and never consumes it", async () => {
    const owner = await device();
    const claimer = await device();
    await upload(owner, { keyPackages: [owner.keyPackage], lastResort: owner.keyPackage });

    await claim(owner.accountId, claimer);
    expect(await held(owner.deviceId)).toEqual({ packages: 0, lastResort: 1 });

    for (let i = 0; i < 2; i++) {
      const { body } = await claim(owner.accountId, claimer);
      expect(body!.keyPackages).toEqual([
        { deviceId: owner.deviceId, keyPackage: owner.keyPackage },
      ]);
    }
    expect(await held(owner.deviceId)).toEqual({ packages: 0, lastResort: 1 });
  });

  it("leaves out a revoked device", async () => {
    const kept = await device();
    const lost = await device({ accountId: kept.accountId });
    const claimer = await device();
    await upload(kept, { keyPackages: [kept.keyPackage] });
    await upload(lost, { keyPackages: [lost.keyPackage] });
    await revoke(lost.deviceId);

    const { body } = await claim(kept.accountId, claimer);
    expect(body!.keyPackages.map((p) => p.deviceId)).toEqual([kept.deviceId]);
    expect(await held(lost.deviceId)).toEqual({ packages: 1, lastResort: 0 });
  });

  it("leaves out the caller's own device, which is already in the group", async () => {
    const phone = await device();
    const tablet = await device({ accountId: phone.accountId });
    await upload(phone, { keyPackages: [phone.keyPackage] });
    await upload(tablet, { keyPackages: [tablet.keyPackage] });

    const { body } = await claim(phone.accountId, phone);
    expect(body!.keyPackages.map((p) => p.deviceId)).toEqual([tablet.deviceId]);
    expect(await held(phone.deviceId)).toEqual({ packages: 1, lastResort: 0 });

    // An account whose only device is the caller has nothing to add.
    const alone = await device();
    await upload(alone, { keyPackages: [alone.keyPackage] });
    const own = await claim(alone.accountId, alone);
    expect(own.response.status).toBe(200);
    expect(own.body!.keyPackages).toEqual([]);
    expect(await held(alone.deviceId)).toEqual({ packages: 1, lastResort: 0 });
  });

  it("answers 404 for an account with no active device", async () => {
    const gone = await device();
    const claimer = await device();
    await revoke(gone.deviceId);
    for (const accountId of [gone.accountId, "a_nobody"]) {
      const { response } = await claim(accountId, claimer);
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toBe("not_found");
    }
  });
});
