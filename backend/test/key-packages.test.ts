import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { expireKeyPackages } from "../src/key-packages.ts";
import { device, revoke } from "./support.ts";
import { hexBytes, mls } from "./mls.ts";
import { worker } from "./main.ts";

// KeyPackages in D1 (decisions 0017, 0018, 0029): uploaded per device and
// naming it, claimed one per active device of an account but the caller's,
// the last resort never consumed, none handed out about to expire.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const post = (path: string, body: unknown, auth: Record<string, string>) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(body),
  });
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;
const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

type Device = Awaited<ReturnType<typeof device>>;

const DAY = 24 * 60 * 60 * 1000;

/** A package naming `owner` that expires `ms` from now, to the second. */
const expiring = (owner: Device, ms: number) =>
  mls.keyPackageNaming(`${owner.accountId}/${owner.deviceId}`, owner.deviceKey, Date.now() + ms);

const seconds = (ms: number) => Math.floor(ms / 1000) * 1000;

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
    expect(await response.json()).toEqual({ available: 2, lastResortNotAfter: null });

    response = await upload(owner, { keyPackages: [owner.keyPackage] });
    expect(await response.json()).toEqual({ available: 3, lastResortNotAfter: null });
  });

  it("does not count the last resort as available, and replaces it", async () => {
    const owner = await device();
    let response = await upload(owner, { keyPackages: [], lastResort: expiring(owner, 50 * DAY) });
    expect(await response.json()).toEqual({
      available: 0,
      lastResortNotAfter: expect.any(Number),
    });
    const notAfter = Date.now() + 84 * DAY;
    const lastResort = mls.keyPackageNaming(
      `${owner.accountId}/${owner.deviceId}`,
      owner.deviceKey,
      notAfter,
    );
    response = await upload(owner, { keyPackages: [], lastResort });
    expect(await response.json()).toEqual({
      available: 0,
      lastResortNotAfter: seconds(notAfter),
    });
    expect(await held(owner.deviceId)).toEqual({ packages: 0, lastResort: 1 });
  });

  it("takes a KeyPackage OpenMLS made for the device, credential and key", async () => {
    const { accountId, deviceId, devicePublic } = mls.keyPackage;
    const owner = await device({ accountId, deviceId, deviceKey: hexBytes(devicePublic) });
    // The fixture's own lifetime ran out long ago; only that is moved.
    const response = await upload(owner, { keyPackages: [expiring(owner, 84 * DAY)] });
    expect(await response.json()).toEqual({ available: 1, lastResortNotAfter: null });
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
    ["a KeyPackage that has expired", (owner) => expiring(owner, -1000)],
    ["a KeyPackage valid for more than 90 days", (owner) => expiring(owner, 91 * DAY)],
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
    expect(await response.json()).toEqual({ available: 100, lastResortNotAfter: null });

    const over = await upload(owner, { keyPackages: [owner.keyPackage] });
    expect(over.status).toBe(400);
    expect(await held(owner.deviceId)).toEqual({ packages: 100, lastResort: 0 });
  });

  it("counts only packages valid for 14 more days", async () => {
    const owner = await device();
    const response = await upload(owner, {
      keyPackages: [owner.keyPackage, expiring(owner, 13 * DAY), expiring(owner, 15 * DAY)],
    });
    expect(await response.json()).toEqual({ available: 2, lastResortNotAfter: null });
    expect(await held(owner.deviceId)).toEqual({ packages: 3, lastResort: 0 });
  });
});

describe("expiring KeyPackages", () => {
  it("deletes expired packages on the sweep, last resorts and rows without an expiry included", async () => {
    const owner = await device();
    await upload(owner, { keyPackages: [owner.keyPackage], lastResort: owner.keyPackage });
    const insert = env.DB.prepare(
      "INSERT INTO key_packages (device_id, key_package, last_resort, created_at, not_after) VALUES (?, ?, ?, ?, ?)",
    );
    const now = Date.now();
    await env.DB.batch([
      insert.bind(owner.deviceId, new Uint8Array([1]), 0, now - DAY, now - 1),
      // Stored before the lifetime was read: it counts as 84 days from then.
      insert.bind(owner.deviceId, new Uint8Array([2]), 0, now - 85 * DAY, null),
      insert.bind(owner.deviceId, new Uint8Array([3]), 0, now - 83 * DAY, null),
    ]);
    expect(await held(owner.deviceId)).toEqual({ packages: 4, lastResort: 1 });

    expect(await expireKeyPackages(env, now)).toBeGreaterThanOrEqual(2);
    expect(await held(owner.deviceId)).toEqual({ packages: 2, lastResort: 1 });

    expect(await expireKeyPackages(env, now + 85 * DAY)).toBeGreaterThanOrEqual(3);
    expect(await held(owner.deviceId)).toEqual({ packages: 0, lastResort: 0 });
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

  it("never hands out a package that expires within a day", async () => {
    const owner = await device();
    const claimer = await device();
    await upload(owner, { keyPackages: [expiring(owner, DAY / 2)] });

    const { response } = await claim(owner.accountId, claimer);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("no_key_packages");
    expect(await held(owner.deviceId)).toEqual({ packages: 1, lastResort: 0 });

    // A last resort about to expire is no better; a fresh one is handed out.
    await upload(owner, { keyPackages: [], lastResort: expiring(owner, DAY / 2) });
    expect((await claim(owner.accountId, claimer)).response.status).toBe(409);
    await upload(owner, { keyPackages: [], lastResort: owner.keyPackage });
    const { body } = await claim(owner.accountId, claimer);
    expect(body!.keyPackages).toEqual([{ deviceId: owner.deviceId, keyPackage: owner.keyPackage }]);
  });

  it("leaves out a device with nothing valid while another has a package", async () => {
    const phone = await device();
    const tablet = await device({ accountId: phone.accountId });
    const claimer = await device();
    await upload(phone, { keyPackages: [phone.keyPackage] });
    await env.DB.prepare(
      "INSERT INTO key_packages (device_id, key_package, last_resort, created_at) VALUES (?, ?, 1, ?)",
    )
      .bind(tablet.deviceId, new Uint8Array([1]), Date.now() - 84 * DAY)
      .run();

    const { body } = await claim(phone.accountId, claimer);
    expect(body!.keyPackages.map((p) => p.deviceId)).toEqual([phone.deviceId]);
  });

  it("answers no_key_packages when no device of the account has a package", async () => {
    const owner = await device();
    const claimer = await device();
    const { response } = await claim(owner.accountId, claimer);
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("no_key_packages");
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
