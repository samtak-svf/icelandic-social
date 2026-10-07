import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import ids from "../../identifiers/ids.json" with { type: "json" };
import { ApiError } from "../src/api/common.ts";
import { brandStrings } from "../src/brand.gen.ts";
import { operatorInvite } from "../scripts/invite-operator.ts";
import { invite, signIn } from "./kenni.ts";

// Invites and the link host (decision 0019): one personal link per account,
// rotated or revoked by its owner; what a link says before sign-in; the page
// a browser shows for it; and the files that hand /l/ links to the apps.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => exports.default.fetch(`${BASE}${path}`, init);
const errorOf = async (response: Response) => ApiError.parse(await response.json()).error;

type Registered = { accountId: string; deviceId: string; token: string };

/** A signed-in person, let in on a fresh operator invite. */
async function person(name = "Prófun Prófsdóttir") {
  const response = await signIn({ inviteToken: await invite({ singleUse: true }), name });
  expect(response.status).toBe(200);
  const me = (await response.json()) as Registered;
  return { ...me, auth: { authorization: `Bearer ${me.token}` } };
}

type Person = Awaited<ReturnType<typeof person>>;

async function rotate(who: Person) {
  const response = await fetch("/v1/me/invite", { method: "POST", headers: who.auth });
  expect(response.status).toBe(200);
  return (await response.json()) as { token: string; link: string };
}

describe("GET /v1/me", () => {
  it("shows the account's name, mark and devices, marking the one that asks", async () => {
    const alice = await person("Alísa Prófsdóttir");
    const response = await fetch("/v1/me", { headers: alice.auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accountId: alice.accountId,
      name: "Alísa Prófsdóttir",
      verified: true,
      devices: [
        {
          deviceId: alice.deviceId,
          platform: "android",
          createdAt: expect.any(Number),
          current: true,
        },
      ],
    });
  });

  it("needs a device token", async () => {
    expect((await fetch("/v1/me")).status).toBe(401);
  });
});

describe("POST /v1/me/invite", () => {
  it("makes a link on the link host that lets someone in, invited by this account", async () => {
    const alice = await person();
    const { token, link } = await rotate(alice);
    expect(link).toBe(`https://${ids.hosts.link}${ids.hosts.linkPathPrefix}${token}`);
    const bob = (await (await signIn({ inviteToken: token })).json()) as Registered;
    const row = await env.DB.prepare(
      "SELECT invited_by AS invitedBy FROM accounts WHERE account_id = ?",
    )
      .bind(bob.accountId)
      .first<{ invitedBy: string }>();
    expect(row?.invitedBy).toBe(alice.accountId);
  });

  it("revokes the link before, so only the newest lets anyone in", async () => {
    const alice = await person();
    const old = await rotate(alice);
    const fresh = await rotate(alice);
    expect(fresh.token).not.toBe(old.token);
    const refused = await signIn({ inviteToken: old.token });
    expect(refused.status).toBe(403);
    expect(await errorOf(refused)).toBe("invite_required");
    expect((await signIn({ inviteToken: fresh.token })).status).toBe(200);
  });

  it("keeps only the token's hash", async () => {
    const alice = await person();
    const { token } = await rotate(alice);
    const dump = JSON.stringify((await env.DB.prepare("SELECT * FROM invites").all()).results);
    expect(dump).not.toContain(token);
  });
});

describe("DELETE /v1/me/invite", () => {
  it("leaves the account with no live link", async () => {
    const alice = await person();
    const { token } = await rotate(alice);
    const response = await fetch("/v1/me/invite", { method: "DELETE", headers: alice.auth });
    expect(response.status).toBe(204);
    expect((await signIn({ inviteToken: token })).status).toBe(403);
    expect((await fetch(`/v1/invites/${token}`)).status).toBe(404);
  });
});

describe("GET /v1/invites/{token}", () => {
  it("names the inviter and their mark, without a device token", async () => {
    const alice = await person("Alísa Prófsdóttir");
    const { token } = await rotate(alice);
    const response = await fetch(`/v1/invites/${token}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      inviter: { accountId: alice.accountId, name: "Alísa Prófsdóttir", verified: true },
    });
  });

  it("names nobody for the operator's invite", async () => {
    const token = await invite({ singleUse: true });
    expect(await (await fetch(`/v1/invites/${token}`)).json()).toEqual({ inviter: null });
  });

  it("answers 404 for a token that is not live", async () => {
    const revoked = await invite({ revoked: true });
    for (const token of [revoked, "a".repeat(43)]) {
      const response = await fetch(`/v1/invites/${token}`);
      expect(response.status).toBe(404);
      expect(await errorOf(response)).toBe("not_found");
    }
  });

  it("answers 404 once a single-use invite is spent", async () => {
    const token = await invite({ singleUse: true });
    expect((await signIn({ inviteToken: token })).status).toBe(200);
    expect((await fetch(`/v1/invites/${token}`)).status).toBe(404);
  });
});

describe("the operator's invite", () => {
  it("lets exactly one person in, and names no inviter", async () => {
    const { token, link, sql } = await operatorInvite();
    expect(link.endsWith(`/l/${token}`)).toBe(true);
    expect(sql).not.toContain(token);
    await env.DB.prepare(sql).run();
    const first = (await (await signIn({ inviteToken: token })).json()) as Registered;
    const row = await env.DB.prepare(
      "SELECT invited_by AS invitedBy FROM accounts WHERE account_id = ?",
    )
      .bind(first.accountId)
      .first<{ invitedBy: string | null }>();
    expect(row?.invitedBy).toBeNull();
    expect((await signIn({ inviteToken: token })).status).toBe(403);
  });
});

describe("the link host", () => {
  it("shows who invited and opens the invite in the app", async () => {
    const alice = await person("Alísa <Prófsdóttir>");
    const { token } = await rotate(alice);
    const response = await fetch(`/l/${token}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const html = await response.text();
    const heading = brandStrings.link_invited_by.replace("{name}", "Alísa &#60;Prófsdóttir&#62;");
    expect(html).toContain(heading);
    expect(html).toContain(`href="${ids.store.urlScheme}://invite/${token}"`);
    expect(html).not.toContain("<Prófsdóttir>");
  });

  it("says a dead link is no longer valid", async () => {
    const response = await fetch(`/l/${await invite({ revoked: true })}`);
    expect(response.status).toBe(404);
    expect(await response.text()).toContain(brandStrings.link_expired);
  });

  it("hands /l/ links to the Android app named in ids.json", async () => {
    const response = await fetch("/.well-known/assetlinks.json");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        relation: ["delegate_permission/common.handle_all_urls"],
        target: {
          namespace: "android_app",
          package_name: ids.store.androidApplicationId,
          sha256_cert_fingerprints: [],
        },
      },
    ]);
  });

  it("hands /l/ links to the iOS app of the interim team", async () => {
    const response = await fetch("/.well-known/apple-app-site-association");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({
      applinks: {
        details: [
          {
            appIDs: [`${ids.appleInterim.teamId}.${ids.appleInterim.iosBundleId}`],
            components: [{ "/": `${ids.hosts.linkPathPrefix}*` }],
          },
        ],
      },
    });
  });
});
