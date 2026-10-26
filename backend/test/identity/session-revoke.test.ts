import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { expireSessions } from "../../src/identity/index.ts";
import { connect } from "../socket.ts";
import { device, linkedBrowser, webSession } from "../support.ts";
import { worker } from "../main.ts";

// Ending a session (decision 0061): the list a person signs clients out
// from, which ends a phone's device with its session; revoking a device,
// which ends a phone's session but not a browser's; and the sweep.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const remove = (path: string, headers: Record<string, string>) =>
  fetch(path, { method: "DELETE", headers });

type Listed = { sessionId: string; kind: string; deviceId: string | null; current: boolean };

async function listed(headers: Record<string, string>) {
  const response = await fetch("/v1/me/sessions", { headers });
  expect(response.status).toBe(200);
  return ((await response.json()) as { sessions: Listed[] }).sessions;
}

/** A phone with its session, healed on its first request as every seeded device is. */
async function phone(accountId?: string) {
  const seeded = await device(accountId ? { accountId } : {});
  const [mine] = (await listed(seeded.auth)).filter((s) => s.deviceId === seeded.deviceId);
  return { ...seeded, sessionId: mine!.sessionId };
}

const sessionCount = async (accountId: string) =>
  (await env.DB.prepare("SELECT count(*) AS n FROM sessions WHERE account_id = ?")
    .bind(accountId)
    .first<{ n: number }>())!.n;

describe("the list", () => {
  it("names every session, a phone's with its device, and marks the one that asks", async () => {
    const mobile = await phone();
    const browser = await webSession({ accountId: mobile.accountId });
    const sessions = await listed(browser.web);
    expect(sessions).toHaveLength(2);
    expect(sessions).toContainEqual(
      expect.objectContaining({
        sessionId: browser.sessionId,
        kind: "web",
        deviceId: null,
        current: true,
      }),
    );
    expect(sessions).toContainEqual(
      expect.objectContaining({
        sessionId: mobile.sessionId,
        kind: "android",
        deviceId: mobile.deviceId,
        current: false,
      }),
    );
  });

  it("holds no other account's sessions", async () => {
    const mine = await webSession();
    await webSession();
    expect((await listed(mine.web)).map((s) => s.sessionId)).toEqual([mine.sessionId]);
  });
});

describe("ending a session", () => {
  it("from a browser signs a phone out: its device is revoked and its socket closes", async () => {
    const mobile = await phone();
    const browser = await webSession({ accountId: mobile.accountId });
    const socket = await connect(mobile.auth);
    expect((await socket.next()).type).toBe("hello");

    expect((await remove(`/v1/sessions/${mobile.sessionId}`, browser.web)).status).toBe(204);

    expect((await socket.closed).code).toBe(4401);
    expect((await fetch("/v1/me", { headers: mobile.auth })).status).toBe(401);
    expect((await listed(browser.web)).map((s) => s.sessionId)).toEqual([browser.sessionId]);
  });

  it("from a phone signs a browser out, and leaves the phone's device", async () => {
    const mobile = await phone();
    const browser = await webSession({ accountId: mobile.accountId });
    expect((await remove(`/v1/sessions/${browser.sessionId}`, mobile.auth)).status).toBe(204);
    expect((await fetch("/v1/me", { headers: browser.web })).status).toBe(401);
    expect((await fetch("/v1/me", { headers: mobile.auth })).status).toBe(200);
  });

  it("of the browser that asks is signing out, clears its cookie and wipes site storage (0064)", async () => {
    const browser = await webSession();
    const response = await remove(`/v1/sessions/${browser.sessionId}`, browser.web);
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toMatch(/^__Host-session=;.*Max-Age=0/i);
    expect(response.headers.get("clear-site-data")).toBe('"storage"');
    const later = await fetch("/v1/me", { headers: browser.web });
    expect(later.status).toBe(401);
    expect(later.headers.get("clear-site-data")).toBe('"storage"');
  });

  it("is refused for another account's session, which stays", async () => {
    const mine = await webSession();
    const theirs = await webSession();
    expect((await remove(`/v1/sessions/${theirs.sessionId}`, mine.web)).status).toBe(404);
    expect((await fetch("/v1/me", { headers: theirs.web })).status).toBe(200);
  });

  it("needs the web origin from a browser, as every change does", async () => {
    const browser = await webSession();
    const headers = { cookie: browser.cookie, origin: "https://evil.test" };
    expect((await remove(`/v1/sessions/${browser.sessionId}`, headers)).status).toBe(403);
    expect((await fetch("/v1/me", { headers: browser.web })).status).toBe(200);
  });
});

describe("ending the other sessions", () => {
  it("ends every one but the one that asks, devices with them", async () => {
    const mobile = await phone();
    const other = await phone(mobile.accountId);
    const browser = await webSession({ accountId: mobile.accountId });
    const response = await fetch("/v1/me/sessions/end-others", {
      method: "POST",
      headers: browser.web,
    });
    expect(await response.json()).toEqual({ ended: 2 });
    for (const auth of [mobile.auth, other.auth]) {
      expect((await fetch("/v1/me", { headers: auth })).status).toBe(401);
    }
    expect((await listed(browser.web)).map((s) => s.sessionId)).toEqual([browser.sessionId]);
  });
});

describe("revoking a device", () => {
  it("ends a phone's session with it", async () => {
    const mobile = await phone();
    const other = await phone(mobile.accountId);
    expect((await remove(`/v1/devices/${other.deviceId}`, mobile.auth)).status).toBe(204);
    expect((await listed(mobile.auth)).map((s) => s.sessionId)).toEqual([mobile.sessionId]);
  });

  it("leaves a browser's session, which is not the device's own", async () => {
    const mobile = await phone();
    const browser = await webSession({ accountId: mobile.accountId });
    // A device linked from the browser (decision 0064) names its session.
    await env.DB.prepare("UPDATE devices SET session_id = ? WHERE device_id = ?")
      .bind(browser.sessionId, mobile.deviceId)
      .run();
    await env.DB.prepare("DELETE FROM sessions WHERE session_id = ?").bind(mobile.sessionId).run();
    expect((await remove(`/v1/devices/${mobile.deviceId}`, browser.web)).status).toBe(204);
    expect((await fetch("/v1/me", { headers: browser.web })).status).toBe(200);
  });
});

describe("deleting the account", () => {
  it("ends every session first", async () => {
    const mobile = await phone();
    const browser = await webSession({ accountId: mobile.accountId });
    expect((await remove("/v1/me", browser.web)).status).toBe(204);
    expect((await fetch("/v1/me", { headers: browser.web })).status).toBe(401);
    expect(await sessionCount(mobile.accountId)).toBe(0);
  });
});

describe("the sweep", () => {
  it("deletes the browser sessions past their expiry, and no phone's", async () => {
    const mobile = await phone();
    const stale = await webSession({ accountId: mobile.accountId, lastSeen: 31 });
    const live = await webSession({ accountId: mobile.accountId, lastSeen: 1 });
    expect(await expireSessions(env)).toBeGreaterThanOrEqual(1);
    const left = (await listed(live.web)).map((s) => s.sessionId);
    expect(left).toContain(live.sessionId);
    expect(left).toContain(mobile.sessionId);
    expect(left).not.toContain(stale.sessionId);
  });
});

describe("Clear-Site-Data reaches only a browser's cookie request (0064)", () => {
  const WIPE = "clear-site-data";

  it("answers a device revoke from the browser's own session", async () => {
    const { browser, enrolled } = await linkedBrowser();
    const response = await remove(`/v1/devices/${enrolled!.deviceId}`, browser.web);
    expect(response.status).toBe(204);
    expect(response.headers.get(WIPE)).toBe('"storage"');
  });

  it("never answers a phone's bearer request", async () => {
    const mobile = await phone();
    const ended = await remove(`/v1/sessions/${mobile.sessionId}`, mobile.auth);
    expect(ended.status).toBe(204);
    expect(ended.headers.get(WIPE)).toBeNull();
    const dead = await fetch("/v1/me", { headers: mobile.auth });
    expect(dead.status).toBe(401);
    expect(dead.headers.get(WIPE)).toBeNull();
  });

  it("never answers a linked device's own bearer request, though its session is a browser's", async () => {
    const { enrolled } = await linkedBrowser();
    const bearer = { authorization: `Bearer ${enrolled!.token}` };
    const response = await remove(`/v1/devices/${enrolled!.deviceId}`, bearer);
    expect(response.status).toBe(204);
    expect(response.headers.get(WIPE)).toBeNull();
  });
});
