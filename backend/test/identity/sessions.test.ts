import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { createRoute, z } from "@hono/zod-openapi";
import { describe, expect, it } from "vitest";
import { createApp, DOCUMENT_INFO } from "../../src/app.ts";
import { CLIENT_HEADER } from "../../src/shared/client-version.ts";
import { signIn } from "../oidc.ts";
import { device, webSession } from "../support.ts";
import { worker } from "../main.ts";

// Sessions (decision 0061): every route declares the credentials it takes,
// and the Worker accepts no other. A device token yields its session; a
// browser's session is a cookie, checked for its Origin on every change.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);
const DAY_MS = 24 * 60 * 60 * 1000;

/** The Worker's app with one more route that only a browser session reaches. */
function withSessionRoute() {
  const app = createApp();
  app.openapi(
    createRoute({
      method: "post",
      path: "/v1/test/session-only",
      security: [{ session: [] }],
      responses: {
        200: {
          description: "ok",
          content: { "application/json": { schema: z.object({ accountId: z.string() }) } },
        },
      },
    }),
    (c) => c.json({ accountId: c.var.session.accountId }, 200),
  );
  return (headers: Record<string, string>) =>
    app.fetch(
      new Request(`${BASE}/v1/test/session-only`, {
        method: "POST",
        headers: { [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}`, ...headers },
      }),
      env,
    );
}

describe("the declaration", () => {
  it("is on every route, and names only the schemes the contract defines", () => {
    const document = createApp().getOpenAPI31Document(DOCUMENT_INFO);
    const schemes = Object.keys(document.components?.securitySchemes ?? {});
    expect(schemes.sort()).toEqual(["deviceToken", "session"]);
    const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
      Object.entries(item ?? {}).map(([method, operation]) => ({
        route: `${method.toUpperCase()} ${path}`,
        security: (operation as { security?: Record<string, string[]>[] }).security,
      })),
    );
    expect(operations.length).toBeGreaterThan(30);
    const undeclared = operations.filter((o) => o.security === undefined).map((o) => o.route);
    expect(undeclared).toEqual([]);
    for (const { security } of operations)
      for (const requirement of security ?? [])
        expect(schemes).toEqual(expect.arrayContaining(Object.keys(requirement)));
  });

  it("is what the Worker enforces: a route that declares none takes nothing", async () => {
    const app = createApp();
    app.openapi(
      createRoute({
        method: "get",
        path: "/v1/test/undeclared",
        responses: { 204: { description: "never" } },
      }),
      (c) => c.body(null, 204),
    );
    const { auth } = await device();
    const { cookie } = await webSession();
    for (const headers of [auth, { cookie }, {}] as Record<string, string>[]) {
      const response = await app.fetch(
        new Request(`${BASE}/v1/test/undeclared`, {
          headers: { [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}`, ...headers },
        }),
        env,
      );
      expect(response.status).toBe(401);
    }
  });
});

describe("a route that takes only a session", () => {
  it("takes a live browser session", async () => {
    const session = await webSession();
    const response = await withSessionRoute()(session.web);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accountId: session.accountId });
  });

  it("refuses a device token", async () => {
    const { auth } = await device();
    expect((await withSessionRoute()(auth)).status).toBe(401);
  });

  it("refuses a session past its 30 days", async () => {
    const session = await webSession({ lastSeen: 31 });
    expect((await withSessionRoute()(session.web)).status).toBe(401);
  });

  it("refuses a secret no session holds", async () => {
    const session = await webSession();
    const forged = { ...session.web, cookie: `__Host-session=st_${"A".repeat(43)}` };
    expect((await withSessionRoute()(forged)).status).toBe(401);
  });
});

describe("a route that takes only a device token", () => {
  it("refuses a browser session", async () => {
    const session = await webSession();
    const response = await fetch("/v1/mutes", { headers: session.web });
    expect(response.status).toBe(401);
  });

  it("takes the device token, as before", async () => {
    const { auth } = await device();
    expect((await fetch("/v1/mutes", { headers: auth })).status).toBe(200);
  });
});

describe("an account route", () => {
  it("takes either, and acts on the same account", async () => {
    const phone = await device();
    const browser = await webSession({ accountId: phone.accountId });
    for (const headers of [phone.auth, browser.web]) {
      const response = await fetch("/v1/me", { headers });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ accountId: phone.accountId });
    }
  });

  it("marks no device current for a browser, which has none", async () => {
    const phone = await device();
    const browser = await webSession({ accountId: phone.accountId });
    const me = (await (await fetch("/v1/me", { headers: browser.web })).json()) as {
      devices: { current: boolean }[];
    };
    expect(me.devices).toEqual([expect.objectContaining({ current: false })]);
  });
});

describe("the Origin check", () => {
  it("refuses a change with the cookie from another origin, or from none", async () => {
    const session = await webSession();
    const send = withSessionRoute();
    for (const origin of [
      "https://evil.example",
      "null",
      "https://spjall.samtak.is.evil.example",
    ]) {
      const response = await send({ cookie: session.cookie, origin });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: "forbidden_origin" });
    }
    expect((await send({ cookie: session.cookie })).status).toBe(403);
    expect((await send(session.web)).status).toBe(200);
  });

  it("refuses it even where a device token would be enough", async () => {
    const phone = await device();
    const session = await webSession({ accountId: phone.accountId });
    const response = await fetch("/v1/me/invite", {
      method: "POST",
      headers: { ...phone.auth, cookie: session.cookie, origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });

  it("leaves a bearer request without the cookie alone", async () => {
    const { auth } = await device();
    const response = await fetch("/v1/me/invite", { method: "POST", headers: auth });
    expect(response.status).toBe(200);
  });
});

describe("renewal", () => {
  async function expiry(sessionId: string) {
    return (await env.DB.prepare("SELECT expires_at AS e FROM sessions WHERE session_id = ?")
      .bind(sessionId)
      .first<{ e: number }>())!.e;
  }

  it("moves the expiry 30 days on, at most once a day, and the cookie with it", async () => {
    const fresh = await webSession();
    const before = await expiry(fresh.sessionId);
    const unchanged = await withSessionRoute()(fresh.web);
    expect(unchanged.headers.get("set-cookie")).toBeNull();
    expect(await expiry(fresh.sessionId)).toBe(before);

    const used = await webSession({ lastSeen: 2 });
    const renewed = await withSessionRoute()(used.web);
    const after = await expiry(used.sessionId);
    expect(after).toBeGreaterThan(Date.now() + 29 * DAY_MS);
    const cookie = renewed.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`__Host-session=${used.secret}`);
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
      expect(cookie).toContain(attribute);
    expect(cookie).not.toContain("Domain");
    expect(new Date(/Expires=([^;]+)/.exec(cookie)![1]!).getTime()).toBe(
      Math.floor(after / 1000) * 1000,
    );
  });

  it("never past 400 days from sign-in", async () => {
    const old = await webSession({ created: 390, lastSeen: 2 });
    await withSessionRoute()(old.web);
    const created = Date.now() - 390 * DAY_MS;
    expect(await expiry(old.sessionId)).toBeLessThanOrEqual(created + 400 * DAY_MS);
  });
});

describe("a phone's session", () => {
  it("is made with its device at sign-in, and named in the answer", async () => {
    const response = await signIn();
    expect(response.status).toBe(200);
    const { accountId, deviceId, sessionId } = (await response.json()) as Record<string, string>;
    expect(sessionId).toMatch(/^s_[A-Za-z0-9_-]{43}$/);
    const row = await env.DB.prepare(
      `SELECT s.account_id AS accountId, s.kind, s.secret_hash AS secret, s.expires_at AS expires
         FROM devices d JOIN sessions s ON s.session_id = d.session_id WHERE d.device_id = ?`,
    )
      .bind(deviceId)
      .first();
    expect(row).toEqual({ accountId, kind: "android", secret: null, expires: null });
  });

  it("is given to an active device that has none, once", async () => {
    const { deviceId, auth } = await device();
    const sessionOf = () =>
      env.DB.prepare("SELECT session_id AS s FROM devices WHERE device_id = ?")
        .bind(deviceId)
        .first<{ s: string | null }>();
    expect((await sessionOf())?.s).toBeNull();
    await Promise.all([fetch("/v1/me", { headers: auth }), fetch("/v1/me", { headers: auth })]);
    const healed = (await sessionOf())?.s;
    expect(healed).toMatch(/^s_/);
    const { count } = (await env.DB.prepare(
      "SELECT count(*) AS count FROM sessions s JOIN devices d ON d.account_id = s.account_id WHERE d.device_id = ?",
    )
      .bind(deviceId)
      .first<{ count: number }>())!;
    expect(count).toBe(1);
  });

  it("is what migration 0013 gives every active device, and no revoked one", async () => {
    const active = await device();
    const revoked = await device();
    await env.DB.prepare("UPDATE devices SET revoked_at = 1 WHERE device_id = ?")
      .bind(revoked.deviceId)
      .run();
    const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };
    const migration = TEST_MIGRATIONS.find((m) => m.name.startsWith("0013_"))!;
    const backfill = migration.queries
      .map((q) => q.replace(/^\s*--.*$/gm, "").trim())
      .filter((q) => /^(PRAGMA|UPDATE devices|INSERT INTO sessions)/.test(q));
    expect(backfill).toHaveLength(3);
    await env.DB.batch(backfill.map((q) => env.DB.prepare(q)));
    const rows = await env.DB.prepare(
      `SELECT d.device_id AS deviceId, s.kind, s.account_id AS accountId
         FROM devices d LEFT JOIN sessions s ON s.session_id = d.session_id
        WHERE d.device_id IN (?, ?) ORDER BY d.device_id = ?`,
    )
      .bind(active.deviceId, revoked.deviceId, revoked.deviceId)
      .all();
    expect(rows.results).toEqual([
      { deviceId: active.deviceId, kind: "android", accountId: active.accountId },
      { deviceId: revoked.deviceId, kind: null, accountId: null },
    ]);
  });
});
