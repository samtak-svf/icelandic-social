import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import ids from "../../identifiers/ids.json" with { type: "json" };
import { ApiError } from "../src/api/common.ts";
import { deleteOrphans } from "../src/accounts.ts";
import { createApp } from "../src/app.ts";
import { CLIENT_HEADER } from "../src/client-version.ts";
import { google } from "../src/env/index.ts";
import { worker } from "./main.ts";
import { link, newKennitala, newSubject, signIn } from "./oidc.ts";
import { euEnv } from "./support.ts";

// Google signs a person in and Kenni verifies them (decision 0033): a new
// account needs no invite, Google's verified address is the only email check,
// identities live in their own table, and linking Kenni earns the mark.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

type Registered = { accountId: string; deviceId: string; token: string };

async function registered(response: Response): Promise<Registered> {
  expect(response.status).toBe(200);
  return (await response.json()) as Registered;
}

const auth = (me: Registered) => ({ authorization: `Bearer ${me.token}` });

async function account(accountId: string) {
  return env.DB.prepare(
    `SELECT display_name AS name, verified, kennitala_hmac AS hmac, invited_by AS invitedBy
       FROM accounts WHERE account_id = ?`,
  )
    .bind(accountId)
    .first<{
      name: string | null;
      verified: number;
      hmac: string | null;
      invitedBy: string | null;
    }>();
}

async function identities(accountId: string) {
  const { results } = await env.DB.prepare(
    "SELECT provider, subject_hmac AS hmac FROM identities WHERE account_id = ? ORDER BY provider",
  )
    .bind(accountId)
    .all<{ provider: string; hmac: string }>();
  return results;
}

const withGoogle = (options: Parameters<typeof signIn>[0] = {}) =>
  signIn({ provider: "google", ...options });

describe("GET /v1/sign-in?provider=google", () => {
  it("hands the app Google's authorize endpoint, the web client and the link host's redirect", async () => {
    const response = await fetch("/v1/sign-in?provider=google");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      authorizationEndpoint: "https://spjall.test/dev/google/oidc/auth",
      clientId: "fake-google-client",
      redirectUri: `https://${ids.hosts.link}/oauth/google`,
      scope: "openid email profile",
    });
  });

  it("answers 503 google_unavailable until the client id and secret are both set", async () => {
    const app = createApp();
    const headers = { [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}` };
    for (const unset of [{ GOOGLE_CLIENT_ID: " " }, { GOOGLE_CLIENT_SECRET: undefined }]) {
      const bare = { ...euEnv(env), GOOGLE_CLIENT_SECRET: "set", ...unset } as Env;
      expect(google(bare)).toBeNull();
      const response = await app.request("/v1/sign-in?provider=google", { headers }, bare);
      expect(response.status).toBe(503);
      expect(await errorOf(response)).toBe("google_unavailable");
    }
  });

  it("refuses a provider it does not know", async () => {
    expect((await fetch("/v1/sign-in?provider=facebook")).status).toBe(400);
  });
});

describe("POST /v1/devices with Google", () => {
  it("makes an unverified account with Google's name for a new person, without an invite", async () => {
    const me = await registered(await withGoogle({ name: "Prófun Prófsdóttir" }));
    expect(await account(me.accountId)).toMatchObject({
      name: "Prófun Prófsdóttir",
      verified: 0,
      hmac: null,
      invitedBy: null,
    });
    const held = await identities(me.accountId);
    expect(held).toEqual([{ provider: "google", hmac: expect.stringMatching(/^[0-9a-f]{64}$/) }]);
  });

  it("gives a returning subject a new device on the same account", async () => {
    const sub = newSubject();
    const first = await registered(await withGoogle({ sub }));
    const second = await registered(await withGoogle({ sub }));
    expect(second.accountId).toBe(first.accountId);
    expect(second.deviceId).not.toBe(first.deviceId);
  });

  it("records the inviter when an invite link brought the person", async () => {
    const inviter = await registered(await withGoogle());
    const rotated = await fetch("/v1/me/invite", { method: "POST", headers: auth(inviter) });
    const { token } = (await rotated.json()) as { token: string };
    const me = await registered(await withGoogle({ inviteToken: token }));
    expect(await account(me.accountId)).toMatchObject({ invitedBy: inviter.accountId });
  });

  it("keeps neither the subject nor the address, not even in the HMAC's place", async () => {
    const sub = newSubject();
    const me = await registered(await withGoogle({ sub }));
    const dump = JSON.stringify([
      (await env.DB.prepare("SELECT * FROM accounts").all()).results,
      (await env.DB.prepare("SELECT * FROM identities").all()).results,
    ]);
    expect(dump).not.toContain(sub);
    expect(dump).not.toContain("@example.com");
    expect(await identities(me.accountId)).toHaveLength(1);
  });

  it("accepts Google's bare issuer as well as its URL", async () => {
    await registered(await withGoogle({ claims: { iss: "spjall.test/dev/google" } }));
  });

  describe("refuses", () => {
    const cases: [string, Parameters<typeof signIn>[0]][] = [
      ["an address Google has not verified", { claims: { email_verified: false } }],
      ["a token that does not say", { claims: { email_verified: null } }],
      ["a verified flag sent as text", { claims: { email_verified: "true" } }],
      ["a token without a subject", { claims: { sub: null } }],
      ["a token for another client", { claims: { aud: "someone-else" } }],
      ["a token from another issuer", { claims: { iss: "https://accounts.example" } }],
      ["a token signed with another key", { sign: "wrong" }],
      ["Kenni's redirect", { register: { redirectUri: "is.samtak.spjall:/kenni" } }],
    ];
    for (const [what, options] of cases) {
      it(what, async () => {
        const response = await withGoogle(options);
        expect(response.status).toBe(403);
        expect(await errorOf(response)).toBe("sign_in_failed");
      });
    }
  });

  it("refuses a body with neither code nor kenniCode", async () => {
    const response = await withGoogle({ register: { code: undefined } });
    expect(response.status).toBe(400);
  });

  it("does not take a Google subject for a kennitala that happens to be equal", async () => {
    const kennitala = newKennitala();
    const kenni = await registered(await signIn({ kennitala }));
    const other = await registered(await withGoogle({ sub: kennitala }));
    expect(other.accountId).not.toBe(kenni.accountId);
  });
});

describe("POST /v1/me/identities", () => {
  it("links Kenni to a Google account: the mark, the registry's name, and Kenni signs in to it", async () => {
    const me = await registered(await withGoogle({ name: "Gúgli" }));
    const kennitala = newKennitala();
    const linked = await link(auth(me), { kennitala, name: "Prófun Prófsdóttir" });
    expect(linked.status).toBe(204);
    expect(await account(me.accountId)).toMatchObject({ name: "Prófun Prófsdóttir", verified: 1 });
    expect((await identities(me.accountId)).map((i) => i.provider)).toEqual(["google", "kenni"]);
    const kenniDevice = await registered(await signIn({ kennitala }));
    expect(kenniDevice.accountId).toBe(me.accountId);
  });

  it("keeps the Google name when Kenni gives none", async () => {
    const me = await registered(await withGoogle({ name: "Gúgli" }));
    expect((await link(auth(me), { name: "" })).status).toBe(204);
    expect(await account(me.accountId)).toMatchObject({ name: "Gúgli", verified: 1 });
  });

  it("links Google to a Kenni account, and Google then signs in to it", async () => {
    const me = await registered(await signIn());
    const sub = newSubject();
    expect((await link(auth(me), { provider: "google", sub })).status).toBe(204);
    expect((await registered(await withGoogle({ sub }))).accountId).toBe(me.accountId);
  });

  it("succeeds again for the identity the account already holds", async () => {
    const kennitala = newKennitala();
    const me = await registered(await signIn({ kennitala }));
    expect((await link(auth(me), { kennitala })).status).toBe(204);
    expect(await identities(me.accountId)).toHaveLength(1);
  });

  it("refuses an identity another account holds", async () => {
    const kennitala = newKennitala();
    const holder = await registered(await signIn({ kennitala }));
    const me = await registered(await withGoogle());
    const response = await link(auth(me), { kennitala });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("identity_taken");
    expect(await account(me.accountId)).toMatchObject({ verified: 0 });
    expect((await identities(holder.accountId)).map((i) => i.provider)).toEqual(["kenni"]);
  });

  it("refuses a second identity of one provider", async () => {
    const me = await registered(await withGoogle());
    expect((await link(auth(me))).status).toBe(204);
    const response = await link(auth(me));
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("already_linked");
  });

  it("refuses an ID token that does not verify, and changes nothing", async () => {
    const me = await registered(await withGoogle());
    const response = await link(auth(me), { claims: { national_id: null } });
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe("sign_in_failed");
    expect(await account(me.accountId)).toMatchObject({ verified: 0 });
  });

  it("needs a device token", async () => {
    expect((await link({})).status).toBe(401);
  });
});

describe("POST /v1/me/identities with merge", () => {
  // Linking Kenni joins a Google sign-in to the account the kennitala holds
  // (decision 0035): the older account is kept, and this device moves to it.
  const merge = (me: Registered, options: Parameters<typeof link>[1] = {}) =>
    link(auth(me), { ...options, register: { merge: true } });
  const send = (method: string, path: string, me: Registered, body?: unknown) =>
    fetch(path, {
      method,
      headers: { "content-type": "application/json", ...auth(me) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const exists = async (accountId: string) =>
    (await env.DB.prepare("SELECT 1 FROM accounts WHERE account_id = ?")
      .bind(accountId)
      .first()) !== null;

  it("joins a Google account into the Kenni account: the device, its token and Google move", async () => {
    const kennitala = newKennitala();
    const older = await registered(await signIn({ kennitala, name: "Prófun Prófsdóttir" }));
    const sub = newSubject();
    const me = await registered(await withGoogle({ sub, name: "Gúgli" }));
    const response = await merge(me, { kennitala, name: "Prófun Prófsdóttir" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accountId: older.accountId });
    expect(await exists(me.accountId)).toBe(false);
    expect((await identities(older.accountId)).map((i) => i.provider)).toEqual(["google", "kenni"]);
    const now = (await (await fetch("/v1/me", { headers: auth(me) })).json()) as {
      accountId: string;
      devices: { deviceId: string }[];
    };
    expect(now.accountId).toBe(older.accountId);
    expect(now.devices.map((d) => d.deviceId).sort()).toEqual([older.deviceId, me.deviceId].sort());
    expect((await registered(await withGoogle({ sub }))).accountId).toBe(older.accountId);
    expect(await account(older.accountId)).toMatchObject({
      name: "Prófun Prófsdóttir",
      verified: 1,
    });
  });

  it("carries blocks over, and drops a block of the older account", async () => {
    const kennitala = newKennitala();
    const older = await registered(await signIn({ kennitala }));
    const other = await registered(await withGoogle());
    const me = await registered(await withGoogle());
    expect((await send("PUT", `/v1/blocks/${other.accountId}`, me)).status).toBe(204);
    expect((await send("PUT", `/v1/blocks/${older.accountId}`, me)).status).toBe(204);
    expect((await merge(me, { kennitala })).status).toBe(200);
    const rows = (sql: string) => env.DB.prepare(sql).bind(older.accountId).first<{ n: number }>();
    expect(await rows("SELECT count(*) AS n FROM blocks WHERE blocker_account_id = ?")).toEqual({
      n: 1,
    });
  });

  it("revokes the joined account's other devices", async () => {
    const kennitala = newKennitala();
    await registered(await signIn({ kennitala }));
    const sub = newSubject();
    const me = await registered(await withGoogle({ sub }));
    const second = await registered(await withGoogle({ sub }));
    expect((await merge(me, { kennitala })).status).toBe(200);
    expect((await fetch("/v1/me", { headers: auth(second) })).status).toBe(401);
  });

  it("drops the moved device's KeyPackages, whose credentials name the account it left", async () => {
    const kennitala = newKennitala();
    await registered(await signIn({ kennitala }));
    const me = await registered(await withGoogle());
    await env.DB.prepare(
      "INSERT INTO key_packages (device_id, key_package, created_at) VALUES (?, x'00', ?)",
    )
      .bind(me.deviceId, Date.now())
      .run();
    expect((await merge(me, { kennitala })).status).toBe(200);
    expect(
      await env.DB.prepare("SELECT count(*) AS n FROM key_packages WHERE device_id = ?")
        .bind(me.deviceId)
        .first(),
    ).toEqual({ n: 0 });
  });

  it("refuses when the older account already holds a Google identity", async () => {
    const kennitala = newKennitala();
    const older = await registered(await withGoogle());
    expect((await link(auth(older), { kennitala })).status).toBe(204);
    const me = await registered(await withGoogle());
    const response = await merge(me, { kennitala });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("identity_taken");
    expect(await exists(me.accountId)).toBe(true);
  });

  it("refuses to join a Kenni account into another", async () => {
    const kennitala = newKennitala();
    await registered(await signIn({ kennitala }));
    const me = await registered(await signIn());
    const response = await merge(me, { kennitala });
    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe("identity_taken");
  });

  it("answers 200 with this account when nothing is joined", async () => {
    const me = await registered(await withGoogle());
    const response = await merge(me);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accountId: me.accountId });
  });

  it("leaves a client that did not ask on 409, unmoved", async () => {
    const kennitala = newKennitala();
    await registered(await signIn({ kennitala }));
    const me = await registered(await withGoogle());
    expect((await link(auth(me), { kennitala })).status).toBe(409);
    expect(await exists(me.accountId)).toBe(true);
  });
});

describe("the daily cron", () => {
  it("deletes an account left without an identity, and no other", async () => {
    const kept = await registered(await withGoogle());
    const orphan = await registered(await withGoogle());
    await env.DB.prepare("DELETE FROM identities WHERE account_id = ?")
      .bind(orphan.accountId)
      .run();
    expect(await deleteOrphans(euEnv(env))).toBe(1);
    const left = await env.DB.prepare(
      "SELECT account_id AS id FROM accounts WHERE account_id IN (?, ?)",
    )
      .bind(kept.accountId, orphan.accountId)
      .all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual([kept.accountId]);
  });
});

describe("identities from before decision 0033", () => {
  it("still sign in through accounts.kennitala_hmac, and are copied into identities", async () => {
    const kennitala = newKennitala();
    const me = await registered(await signIn({ kennitala }));
    // As old code left a row made between migration 0008 and the deploy.
    await env.DB.prepare("DELETE FROM identities WHERE account_id = ?").bind(me.accountId).run();
    expect((await registered(await signIn({ kennitala }))).accountId).toBe(me.accountId);
    expect((await identities(me.accountId)).map((i) => i.provider)).toEqual(["kenni"]);
  });

  it("are copied by migration 0008 with the HMAC unchanged", async () => {
    const { TEST_MIGRATIONS } = env as unknown as {
      TEST_MIGRATIONS: { name: string; queries: string[] }[];
    };
    const copy = TEST_MIGRATIONS.find((m) => m.name.startsWith("0008_"))?.queries.find((q) =>
      q.includes("INSERT INTO identities"),
    );
    expect(copy).toBeDefined();
    const me = await registered(await signIn());
    const before = await identities(me.accountId);
    await env.DB.prepare("DELETE FROM identities WHERE account_id = ?").bind(me.accountId).run();
    await env.DB.prepare(`${copy?.replace("INSERT INTO", "INSERT OR IGNORE INTO")}`).run();
    expect(await identities(me.accountId)).toEqual(before);
    expect(before[0]?.hmac).toBe((await account(me.accountId))?.hmac);
  });
});

describe("the link host's /oauth/google", () => {
  it("passes the code and state on to the app, and nothing else", async () => {
    const response = await fetch(
      "/oauth/google?code=4%2F0abc&state=s123&scope=openid%20email&authuser=0&prompt=consent",
      { redirect: "manual" },
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") ?? "");
    expect(`${location.protocol}${location.pathname}`).toBe(`${ids.store.urlScheme}:/google`);
    expect([...location.searchParams]).toEqual([
      ["code", "4/0abc"],
      ["state", "s123"],
    ]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("passes an error on, so the app can say the sign-in was cancelled", async () => {
    const response = await fetch("/oauth/google?error=access_denied&state=s1", {
      redirect: "manual",
    });
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("error")).toBe("access_denied");
  });
});

describe("logs", () => {
  afterEach(() => vi.restoreAllMocks());

  it("name the provider, never the subject, the name or the address", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const sub = newSubject();
    const me = await registered(await withGoogle({ sub, name: "Leynd Leyndardóttir" }));
    await withGoogle({ sub, claims: { email_verified: false } });
    await link(auth(me), { name: "Leynd Leyndardóttir" });
    const lines = spy.mock.calls.map(([line]) => String(line));
    expect(lines.some((line) => line.includes('"provider":"google"'))).toBe(true);
    expect(lines.some((line) => line.includes("email_unverified"))).toBe(true);
    expect(lines.some((line) => line.includes("identity.linked"))).toBe(true);
    for (const line of lines) {
      expect(line).not.toContain(sub);
      expect(line).not.toContain("Leynd");
      expect(line).not.toContain("@example.com");
      expect(line).not.toContain(me.token);
    }
  });
});
