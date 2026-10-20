import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { fromBase64, toBase64 } from "../src/bytes.ts";
import { expireLinkedDevices, LINKED_IDLE_MS } from "../src/identity/index.ts";
import { device, euEnv, webSession } from "./support.ts";
import { worker } from "./main.ts";

// Linked non-phone devices (decision 0064, #299): enrolled from a web session
// only after an active phone of the same account approves by signing the new
// device's Ed25519 key; holds the server's 32-byte store-key share for its
// owning session; expires after 45 days without use; and revoking the device
// leaves the web session signed in, whereas ending the session revokes the
// device.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);

/** A phone device backed by a real Ed25519 key pair so it can sign link approvals. */
async function phoneWithKey(accountId?: string) {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const seeded = await device(accountId ? { accountId } : {});
  await env.DB.prepare("UPDATE devices SET device_key = ? WHERE device_id = ?")
    .bind(publicKey, seeded.deviceId)
    .run();
  return {
    ...seeded,
    publicKey,
    sign: async (message: Uint8Array) =>
      new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, message)),
  };
}

function randomKeyBase64() {
  return toBase64(crypto.getRandomValues(new Uint8Array(32)));
}

describe("enrolling a linked device from a session (decision 0064, #299)", () => {
  it("creates no device without an active phone's Ed25519 approval signature", async () => {
    // 1. An account with only a browser session and no phone cannot start linking.
    const phoneLess = await webSession();
    const refusedNoPhone = await fetch("/v1/devices/link-requests", {
      method: "POST",
      headers: { ...phoneLess.web, "content-type": "application/json" },
      body: JSON.stringify({ deviceKey: randomKeyBase64(), historyKey: randomKeyBase64() }),
    });
    expect(refusedNoPhone.status).toBe(403);
    expect(await refusedNoPhone.json()).toMatchObject({ error: "no_phone_device" });

    // 2. With an active phone on the account, the browser creates a pending link request.
    const phone = await phoneWithKey();
    const browser = await webSession({ accountId: phone.accountId });
    const newDeviceKey = crypto.getRandomValues(new Uint8Array(32));
    const historyKey = crypto.getRandomValues(new Uint8Array(32));

    const startRes = await fetch("/v1/devices/link-requests", {
      method: "POST",
      headers: { ...browser.web, "content-type": "application/json" },
      body: JSON.stringify({
        deviceKey: toBase64(newDeviceKey),
        historyKey: toBase64(historyKey),
      }),
    });
    expect(startRes.status).toBe(200);
    const { linkId } = (await startRes.json()) as { linkId: string; expiresAt: number };

    // 3. Completing before phone approval is refused with 409 not_approved.
    const unapproved = await fetch(`/v1/devices/link-requests/${linkId}/complete`, {
      method: "POST",
      headers: browser.web,
    });
    expect(unapproved.status).toBe(409);
    expect(await unapproved.json()).toMatchObject({ error: "not_approved" });

    // 4. A signature over the wrong bytes or from another account's phone is refused.
    const badSig = await phone.sign(crypto.getRandomValues(new Uint8Array(32)));
    const badApprove = await fetch(`/v1/devices/link-requests/${linkId}/approve`, {
      method: "POST",
      headers: { ...phone.auth, "content-type": "application/json" },
      body: JSON.stringify({ signature: toBase64(badSig) }),
    });
    expect(badApprove.status).toBe(403);
    expect(await badApprove.json()).toMatchObject({ error: "invalid_signature" });

    const strangerPhone = await phoneWithKey();
    const strangerSig = await strangerPhone.sign(newDeviceKey);
    const strangerApprove = await fetch(`/v1/devices/link-requests/${linkId}/approve`, {
      method: "POST",
      headers: { ...strangerPhone.auth, "content-type": "application/json" },
      body: JSON.stringify({ signature: toBase64(strangerSig) }),
    });
    expect(strangerApprove.status).toBe(404);

    // 5. The account's phone inspects the request, signs the new device's key, and approves.
    const infoRes = await fetch(`/v1/devices/link-requests/${linkId}`, { headers: phone.auth });
    expect(infoRes.status).toBe(200);
    expect(await infoRes.json()).toMatchObject({
      linkId,
      sessionId: browser.sessionId,
      deviceKey: toBase64(newDeviceKey),
      historyKey: toBase64(historyKey),
      approved: false,
    });

    const validSig = await phone.sign(newDeviceKey);
    const approveRes = await fetch(`/v1/devices/link-requests/${linkId}/approve`, {
      method: "POST",
      headers: { ...phone.auth, "content-type": "application/json" },
      body: JSON.stringify({ signature: toBase64(validSig) }),
    });
    expect(approveRes.status).toBe(204);

    // 6. Another browser session of the same account cannot complete this session's request.
    const otherBrowser = await webSession({ accountId: phone.accountId });
    const wrongSession = await fetch(`/v1/devices/link-requests/${linkId}/complete`, {
      method: "POST",
      headers: otherBrowser.web,
    });
    expect(wrongSession.status).toBe(404);

    // 7. The enrolling browser session completes the link and receives its token and storeKeyShare.
    const completeRes = await fetch(`/v1/devices/link-requests/${linkId}/complete`, {
      method: "POST",
      headers: browser.web,
    });
    expect(completeRes.status).toBe(200);
    const enrolled = (await completeRes.json()) as {
      accountId: string;
      deviceId: string;
      sessionId: string;
      token: string;
      storeKeyShare: string;
    };
    expect(enrolled.accountId).toBe(phone.accountId);
    expect(enrolled.sessionId).toBe(browser.sessionId);
    expect(fromBase64(enrolled.storeKeyShare)).toHaveLength(32);

    // 8. Only the owning browser session can read its storeKeyShare.
    const shareRes = await fetch("/v1/devices/me/store-key", { headers: browser.web });
    expect(shareRes.status).toBe(200);
    expect(await shareRes.json()).toEqual({
      deviceId: enrolled.deviceId,
      storeKeyShare: enrolled.storeKeyShare,
    });
    expect((await fetch("/v1/devices/me/store-key", { headers: otherBrowser.web })).status).toBe(
      404,
    );

    // 9. A linked device cannot approve another linked device (phone_required).
    const thirdKey = crypto.getRandomValues(new Uint8Array(32));
    const thirdStart = await fetch("/v1/devices/link-requests", {
      method: "POST",
      headers: { ...otherBrowser.web, "content-type": "application/json" },
      body: JSON.stringify({
        deviceKey: toBase64(thirdKey),
        historyKey: randomKeyBase64(),
      }),
    });
    const { linkId: thirdLinkId } = (await thirdStart.json()) as { linkId: string };
    const linkedAuth = {
      ...phone.auth,
      authorization: `Bearer ${enrolled.token}`,
    };
    const linkedApprove = await fetch(`/v1/devices/link-requests/${thirdLinkId}/approve`, {
      method: "POST",
      headers: { ...linkedAuth, "content-type": "application/json" },
      body: JSON.stringify({ signature: toBase64(validSig) }),
    });
    expect(linkedApprove.status).toBe(403);
    expect(await linkedApprove.json()).toMatchObject({ error: "phone_required" });
  });

  it("removes a linked device after 45 days of inactivity while keeping phones and the web session", async () => {
    const phone = await phoneWithKey();
    const browser = await webSession({ accountId: phone.accountId });
    const newDeviceKey = crypto.getRandomValues(new Uint8Array(32));
    const startRes = await fetch("/v1/devices/link-requests", {
      method: "POST",
      headers: { ...browser.web, "content-type": "application/json" },
      body: JSON.stringify({
        deviceKey: toBase64(newDeviceKey),
        historyKey: randomKeyBase64(),
      }),
    });
    const { linkId } = (await startRes.json()) as { linkId: string };
    const sig = await phone.sign(newDeviceKey);
    await fetch(`/v1/devices/link-requests/${linkId}/approve`, {
      method: "POST",
      headers: { ...phone.auth, "content-type": "application/json" },
      body: JSON.stringify({ signature: toBase64(sig) }),
    });
    const completeRes = await fetch(`/v1/devices/link-requests/${linkId}/complete`, {
      method: "POST",
      headers: browser.web,
    });
    const { deviceId: linkedDeviceId, token } = (await completeRes.json()) as {
      deviceId: string;
      token: string;
    };
    const linkedAuth = { ...phone.auth, authorization: `Bearer ${token}` };

    // Before expiry, the linked device is listed on /v1/me with kind = 'web'.
    const meBefore = (await (await fetch("/v1/me", { headers: linkedAuth })).json()) as {
      devices: { deviceId: string; kind: string }[];
    };
    expect(meBefore.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ deviceId: phone.deviceId, kind: "phone" }),
        expect.objectContaining({ deviceId: linkedDeviceId, kind: "web" }),
      ]),
    );

    // Age both the phone and the linked device past 45 days.
    const stale = Date.now() - LINKED_IDLE_MS - 1000;
    await env.DB.prepare("UPDATE devices SET created_at = ?, last_seen_at = ? WHERE account_id = ?")
      .bind(stale, stale, phone.accountId)
      .run();

    // The linked device token is refused at once, even before the daily sweep runs.
    expect((await fetch("/v1/me", { headers: linkedAuth })).status).toBe(401);

    // The daily sweep revokes the expired linked device, wipes its store key share, and leaves the phone.
    expect(await expireLinkedDevices(euEnv(env))).toBe(1);
    expect((await fetch("/v1/me", { headers: phone.auth })).status).toBe(200);
    const meAfter = (await (await fetch("/v1/me", { headers: browser.web })).json()) as {
      devices: { deviceId: string; kind: string }[];
    };
    expect(meAfter.devices.map((d) => d.deviceId)).toEqual([phone.deviceId]);
    expect((await fetch("/v1/devices/me/store-key", { headers: browser.web })).status).toBe(404);
  });

  it("keeps the web session alive when its linked device is revoked, and revokes the device when the session ends", async () => {
    const phone = await phoneWithKey();
    const browser = await webSession({ accountId: phone.accountId });
    const firstKey = crypto.getRandomValues(new Uint8Array(32));
    const start1 = await fetch("/v1/devices/link-requests", {
      method: "POST",
      headers: { ...browser.web, "content-type": "application/json" },
      body: JSON.stringify({ deviceKey: toBase64(firstKey), historyKey: randomKeyBase64() }),
    });
    const { linkId: link1 } = (await start1.json()) as { linkId: ToString };
    await fetch(`/v1/devices/link-requests/${String(link1)}/approve`, {
      method: "POST",
      headers: { ...phone.auth, "content-type": "application/json" },
      body: JSON.stringify({ signature: toBase64(await phone.sign(firstKey)) }),
    });
    const enrolled1 = (await (
      await fetch(`/v1/devices/link-requests/${String(link1)}/complete`, {
        method: "POST",
        headers: browser.web,
      })
    ).json()) as { deviceId: string; token: string };

    // Revoking the linked device revokes its token and wipes its store key, but the web session survives.
    const revokeRes = await fetch(`/v1/devices/${enrolled1.deviceId}`, {
      method: "DELETE",
      headers: browser.web,
    });
    expect(revokeRes.status).toBe(204);
    expect(revokeRes.headers.get("clear-site-data")).toBe('"storage"');
    expect(
      (
        await fetch("/v1/me", {
          headers: { ...phone.auth, authorization: `Bearer ${enrolled1.token}` },
        })
      ).status,
    ).toBe(401);
    expect((await fetch("/v1/me", { headers: browser.web })).status).toBe(200);

    // Link again on the surviving session, then end the session: the linked device is revoked with it.
    const secondKey = crypto.getRandomValues(new Uint8Array(32));
    const start2 = await fetch("/v1/devices/link-requests", {
      method: "POST",
      headers: { ...browser.web, "content-type": "application/json" },
      body: JSON.stringify({ deviceKey: toBase64(secondKey), historyKey: randomKeyBase64() }),
    });
    const { linkId: link2 } = (await start2.json()) as { linkId: string };
    await fetch(`/v1/devices/link-requests/${link2}/approve`, {
      method: "POST",
      headers: { ...phone.auth, "content-type": "application/json" },
      body: JSON.stringify({ signature: toBase64(await phone.sign(secondKey)) }),
    });
    const enrolled2 = (await (
      await fetch(`/v1/devices/link-requests/${link2}/complete`, {
        method: "POST",
        headers: browser.web,
      })
    ).json()) as { deviceId: string; token: string };

    const endRes = await fetch(`/v1/sessions/${browser.sessionId}`, {
      method: "DELETE",
      headers: browser.web,
    });
    expect(endRes.status).toBe(204);
    expect(endRes.headers.get("clear-site-data")).toBe('"storage"');
    expect(
      (
        await fetch("/v1/me", {
          headers: { ...phone.auth, authorization: `Bearer ${enrolled2.token}` },
        })
      ).status,
    ).toBe(401);
  });
});

type ToString = string;
