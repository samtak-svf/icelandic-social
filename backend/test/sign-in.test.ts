import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerDevice } from "../src/accounts.ts";
import { ApiError } from "../src/api/common.ts";
import { fromBase64, toBase64 } from "../src/bytes.ts";
import { authorize, invite, newKennitala, registerWith, signIn } from "./oidc.ts";
import { device } from "./support.ts";
import { worker } from "./main.ts";

// Sign-in with Kenni (decisions 0019, 0033): the Worker redeems the app's
// code at Kenni, verifies the ID token itself, and gives the person a device
// on their account, or on a new verified one. Google is google-sign-in.test.ts.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

type Registered = { accountId: string; deviceId: string; token: string };

async function registered(response: Response): Promise<Registered> {
  expect(response.status).toBe(200);
  return (await response.json()) as Registered;
}

async function account(accountId: string) {
  return env.DB.prepare(
    `SELECT display_name AS name, verified, kennitala_hmac AS hmac, invited_by AS invitedBy
       FROM accounts WHERE account_id = ?`,
  )
    .bind(accountId)
    .first<{ name: string | null; verified: number; hmac: string; invitedBy: string | null }>();
}

describe("GET /v1/sign-in", () => {
  it("hands the app the issuer's authorize endpoint, the client and the scopes", async () => {
    const response = await fetch("/v1/sign-in");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authorizationEndpoint: "https://spjall.test/dev/kenni/oidc/auth",
      clientId: "@innskraning.is/spjall",
      redirectUri: "is.samtak.spjall:/kenni",
      scope: "openid national_id audkenni_name",
    });
  });
});

describe("POST /v1/devices", () => {
  it("makes a verified account for a new person who has no invite", async () => {
    const me = await registered(await signIn({ name: "Prófun Prófsdóttir" }));
    expect(await account(me.accountId)).toMatchObject({
      name: "Prófun Prófsdóttir",
      verified: 1,
      invitedBy: null,
    });
  });

  it("makes an account with the registry's name and the mark for an invited person", async () => {
    const inviter = await device();
    const token = await invite({ inviter: inviter.accountId });
    const me = await registered(await signIn({ inviteToken: token, name: "Prófun Prófsdóttir" }));
    expect(me.accountId).not.toBe(inviter.accountId);
    expect(await account(me.accountId)).toMatchObject({
      name: "Prófun Prófsdóttir",
      verified: 1,
      invitedBy: inviter.accountId,
    });
  });

  it("keeps the name null when Kenni sends none", async () => {
    const me = await registered(await signIn({ inviteToken: await invite(), name: "" }));
    expect(await account(me.accountId)).toMatchObject({ name: null, verified: 1, invitedBy: null });
  });

  it("keeps the kennitala only as an HMAC", async () => {
    const kennitala = newKennitala();
    const me = await registered(await signIn({ kennitala, inviteToken: await invite() }));
    const row = await account(me.accountId);
    expect(row?.hmac).toMatch(/^[0-9a-f]{64}$/);
    const dump = JSON.stringify((await env.DB.prepare("SELECT * FROM accounts").all()).results);
    expect(dump).not.toContain(kennitala);
  });

  it("gives a returning person a new device on the same account, without an invite", async () => {
    const kennitala = newKennitala();
    const first = await registered(await signIn({ kennitala, inviteToken: await invite() }));
    const second = await registered(await signIn({ kennitala }));
    expect(second.accountId).toBe(first.accountId);
    expect(second.deviceId).not.toBe(first.deviceId);
    expect(second.token).not.toBe(first.token);
  });

  it("finds an account under the previous key while a rotation runs, and moves it", async () => {
    const kennitala = newKennitala();
    const first = await registered(await signIn({ kennitala, inviteToken: await invite() }));
    const before = (await account(first.accountId))?.hmac;
    const keys = (secrets: Record<string, string>) =>
      Object.assign(Object.create(env) as Env, secrets);
    const again = (under: Env) =>
      registerDevice(
        under,
        { provider: "kenni", subject: kennitala, name: null },
        {
          platform: "android",
          deviceKey: crypto.getRandomValues(new Uint8Array(32)),
          inviteToken: undefined,
        },
      );

    // A new key alone orphans the account, and the person gets a second one;
    // that is why the previous key stays. The orphan's twin is removed again.
    const orphaned = await again(keys({ KENNITALA_HMAC_KEY: "rotated-test-key" }));
    if (!("ok" in orphaned)) throw new Error("no account");
    expect(orphaned.ok.accountId).not.toBe(first.accountId);
    await env.DB.prepare("DELETE FROM accounts WHERE account_id = ?")
      .bind(orphaned.ok.accountId)
      .run();
    const rotating = keys({
      KENNITALA_HMAC_KEY: "rotated-test-key",
      KENNITALA_HMAC_KEY_PREVIOUS: "test-only-kennitala-key",
    });
    expect(await again(rotating)).toMatchObject({ ok: { accountId: first.accountId } });
    const after = (await account(first.accountId))?.hmac;
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
    // Moved: the new key finds it with the previous one gone.
    expect(await again(keys({ KENNITALA_HMAC_KEY: "rotated-test-key" }))).toMatchObject({
      ok: { accountId: first.accountId },
    });
  });

  it("refuses a device key another device registered, the same person's or not", async () => {
    const kennitala = newKennitala();
    const deviceKey = toBase64(crypto.getRandomValues(new Uint8Array(32)));
    await registered(
      await signIn({ kennitala, inviteToken: await invite(), register: { deviceKey } }),
    );
    for (const again of [
      await signIn({ kennitala, register: { deviceKey } }),
      await signIn({ inviteToken: await invite(), register: { deviceKey } }),
    ]) {
      expect(again.status).toBe(409);
      expect(await errorOf(again)).toBe("device_key_taken");
    }
    const devices = await env.DB.prepare("SELECT count(*) AS n FROM devices WHERE device_key = ?")
      .bind(fromBase64(deviceKey))
      .first<{ n: number }>();
    expect(devices?.n).toBe(1);
  });

  it("holds one device per key in D1 itself", async () => {
    const first = await device();
    await expect(device({ deviceKey: first.deviceKey })).rejects.toThrow(/UNIQUE/);
  });

  it("issues a token that works as Bearer", async () => {
    const me = await registered(await signIn({ inviteToken: await invite() }));
    const response = await fetch("/v1/key-packages", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${me.token}` },
      body: JSON.stringify({ keyPackages: [] }),
    });
    expect(response.status).not.toBe(401);
  });

  it("records no inviter for a revoked invite, or one that does not exist", async () => {
    const inviter = (await device()).accountId;
    for (const inviteToken of [await invite({ inviter, revoked: true }), "no-such-invite-token"]) {
      const me = await registered(await signIn({ inviteToken }));
      expect(await account(me.accountId)).toMatchObject({ invitedBy: null });
    }
  });

  it("spends a single-use invite on the first person, and records nobody after", async () => {
    const inviter = (await device()).accountId;
    const token = await invite({ inviter, singleUse: true });
    const first = await registered(await signIn({ inviteToken: token }));
    expect(await account(first.accountId)).toMatchObject({ invitedBy: inviter });
    const second = await registered(await signIn({ inviteToken: token }));
    expect(await account(second.accountId)).toMatchObject({ invitedBy: null });
  });

  it("lets many people in on a personal invite", async () => {
    const token = await invite({ inviter: (await device()).accountId });
    await registered(await signIn({ inviteToken: token }));
    await registered(await signIn({ inviteToken: token }));
  });

  describe("refuses an ID token that does not verify", () => {
    const cases: [string, Parameters<typeof signIn>[0]][] = [
      ["signed with another key", { sign: "wrong" }],
      ["naming no key", { sign: "nokid" }],
      ["for another client", { claims: { aud: "@innskraning.is/someone-else" } }],
      ["from another issuer", { claims: { iss: "https://idp.kenni.is/elsewhere" } }],
      ["expired", { claims: { exp: Math.floor(Date.now() / 1000) - 3600 } }],
      ["with another nonce", { claims: { nonce: "a-nonce-the-app-never-made" } }],
      ["without a kennitala", { claims: { national_id: null } }],
    ];
    for (const [what, options] of cases) {
      it(what, async () => {
        const response = await signIn({ ...options, inviteToken: await invite() });
        expect(response.status).toBe(403);
        expect(await errorOf(response)).toBe("sign_in_failed");
      });
    }
  });

  it("refuses the wrong PKCE verifier", async () => {
    const response = await signIn({
      inviteToken: await invite(),
      register: { codeVerifier: "x".repeat(43) },
    });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("sign_in_failed");
  });

  it("refuses a code used twice", async () => {
    const { code, verifier, nonce, redirectUri } = await authorize();
    const body = {
      kenniCode: code,
      codeVerifier: verifier,
      redirectUri,
      nonce,
      platform: "ios",
      deviceKey: btoa("k".repeat(32)),
      inviteToken: await invite(),
    };
    await registered(await registerWith(body));
    const again = await registerWith(body);
    expect(again.status).toBe(403);
    expect(await errorOf(again)).toBe("sign_in_failed");
  });

  it("refuses a redirect that is not the app's", async () => {
    const response = await signIn({
      inviteToken: await invite(),
      register: { redirectUri: "https://evil.example/kenni" },
    });
    expect(response.status).toBe(403);
  });

  describe("logs", () => {
    afterEach(() => vi.restoreAllMocks());

    it("carry neither the kennitala nor the name, nor the token", async () => {
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const kennitala = newKennitala();
      const name = "Leynd Leyndardóttir";
      await signIn({ kennitala, name });
      const me = await registered(await signIn({ kennitala, name, inviteToken: await invite() }));
      const lines = spy.mock.calls.map(([line]) => String(line));
      expect(lines.some((line) => line.includes("device.registered"))).toBe(true);
      for (const line of lines) {
        expect(line).not.toContain(kennitala);
        expect(line).not.toContain("Leynd");
        expect(line).not.toContain(me.token);
      }
    });
  });
});
