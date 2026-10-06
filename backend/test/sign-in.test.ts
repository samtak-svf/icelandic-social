import { env, exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/common.ts";
import { fromBase64, toBase64 } from "../src/bytes.ts";
import { authorize, invite, newKennitala, registerWith, signIn } from "./kenni.ts";
import { device } from "./support.ts";

// Sign-in with Kenni (decision 0019): the Worker redeems the app's code at
// Kenni, verifies the ID token itself, and gives the person a device on their
// account, or on a new one when an invite lets them in.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => exports.default.fetch(`${BASE}${path}`, init);
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
      clientId: "@innskraning.is/samtak-spjall",
      redirectUri: "is.samtak.spjall:/kenni",
      scope: "openid national_id audkenni_name",
    });
  });
});

describe("POST /v1/devices", () => {
  it("refuses a new person who has no invite", async () => {
    const response = await signIn();
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("invite_required");
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

  it("refuses a revoked invite", async () => {
    const response = await signIn({ inviteToken: await invite({ revoked: true }) });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("invite_required");
  });

  it("refuses an invite that does not exist", async () => {
    const response = await signIn({ inviteToken: "no-such-invite-token" });
    expect(response.status).toBe(403);
  });

  it("lets one person in on a single-use invite, and nobody after", async () => {
    const token = await invite({ singleUse: true });
    await registered(await signIn({ inviteToken: token }));
    const second = await signIn({ inviteToken: token });
    expect(second.status).toBe(403);
    expect(await errorOf(second)).toBe("invite_required");
  });

  it("lets many people in on a personal invite", async () => {
    const token = await invite({ inviter: (await device()).accountId });
    await registered(await signIn({ inviteToken: token }));
    await registered(await signIn({ inviteToken: token }));
  });

  describe("refuses an ID token that does not verify", () => {
    const cases: [string, Parameters<typeof signIn>[0]][] = [
      ["signed with another key", { wrongKey: true }],
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
      expect(lines.some((line) => line.includes("invite_required"))).toBe(true);
      for (const line of lines) {
        expect(line).not.toContain(kennitala);
        expect(line).not.toContain("Leynd");
        expect(line).not.toContain(me.token);
      }
    });
  });
});
