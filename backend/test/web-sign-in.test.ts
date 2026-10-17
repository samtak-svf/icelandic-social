import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { newKennitala, newSubject } from "./oidc.ts";
import { worker } from "./main.ts";

// Web sign-in (decisions 0061, 0062): the Worker runs the flow, and a browser
// ends with a session cookie and no device.

const BASE = "https://spjall.test";
const WEB = "https://spjall.samtak.is";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

type Provider = "kenni" | "google";

/** The cookie a response sets under `name`, as a browser would send it back. */
function cookieOf(response: Response, name: string) {
  const line = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return line?.split(";")[0];
}

/** GET /auth/{provider}/start: the provider's URL and the flow cookie. */
async function start(provider: Provider = "kenni", next?: string) {
  const query = next === undefined ? "" : `?next=${encodeURIComponent(next)}`;
  const response = await worker.fetch(`${BASE}/auth/${provider}/start${query}`, {
    redirect: "manual",
  });
  return {
    response,
    location: response.headers.get("location") ?? "",
    flow: cookieOf(response, "__Host-sign-in"),
  };
}

/** The person signs in at the fake provider: the callback URL it sends the browser back to. */
async function atProvider(location: string, provider: Provider, person?: string) {
  const url = new URL(location);
  url.searchParams.set(
    "login_hint",
    person ?? (provider === "kenni" ? newKennitala() : newSubject()),
  );
  const redirect = await worker.fetch(url.toString(), { redirect: "manual" });
  return new URL(redirect.headers.get("location") ?? "");
}

function callback(back: URL, cookie: string | undefined) {
  return worker.fetch(`${BASE}${back.pathname}${back.search}`, {
    redirect: "manual",
    headers: { "user-agent": FIREFOX, ...(cookie ? { cookie } : {}) },
  });
}

/** A whole web sign-in: the callback's response. */
async function webSignIn(
  provider: Provider = "kenni",
  { next, person }: { next?: string; person?: string } = {},
) {
  const { location, flow } = await start(provider, next);
  return callback(await atProvider(location, provider, person), flow);
}

const countOf = async (sql: string, ...bind: unknown[]) =>
  (await env.DB.prepare(sql)
    .bind(...bind)
    .first<{ n: number }>())!.n;

describe("the start", () => {
  it("sends the browser to the provider with PKCE, state and nonce, and seals the flow", async () => {
    const { response, location, flow } = await start("kenni", "/c/abc");
    expect(response.status).toBe(302);
    const url = new URL(location);
    expect(url.pathname).toBe("/dev/kenni/oidc/auth");
    const q = url.searchParams;
    expect(q.get("client_id")).toBe("@innskraning.is/spjall-web");
    expect(q.get("redirect_uri")).toBe(`${WEB}/auth/kenni/callback`);
    expect(q.get("code_challenge_method")).toBe("S256");
    for (const key of ["state", "nonce", "code_challenge"])
      expect(q.get(key)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const line = response.headers.getSetCookie().find((c) => c.startsWith("__Host-sign-in="))!;
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
      expect(line).toContain(attribute);
    // Sealed: neither the state nor anything else of the flow is readable in it.
    expect(flow).not.toContain(q.get("state"));
    expect(flow).not.toContain("/c/abc");
  });

  it("refuses to send the browser anywhere but a path on the web host afterwards", async () => {
    for (const next of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example/",
      "evil",
      "/a b",
      "",
    ]) {
      expect((await start("kenni", next)).response.status).toBe(400);
    }
    expect((await start("kenni", "/c/abc?x=1")).response.status).toBe(302);
  });

  it("answers 503 for Kenni while its web client has no secret", async () => {
    const response = await createApp().fetch(new Request(`${BASE}/auth/kenni/start`), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "kenni_unavailable" });
  });
});

describe("the callback", () => {
  for (const provider of ["kenni", "google"] as const) {
    it(`signs in with ${provider}, sets the session cookie and returns to the asked path`, async () => {
      const response = await webSignIn(provider, { next: "/c/abc?x=1" });
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe("/c/abc?x=1");
      const line = response.headers.getSetCookie().find((c) => c.startsWith("__Host-session="))!;
      for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
        expect(line).toContain(attribute);
      expect(line).not.toContain("Domain");
      const cookie = cookieOf(response, "__Host-session")!;
      const me = await worker.fetch(`${BASE}/v1/me`, { headers: { cookie } });
      expect(me.status).toBe(200);
    });
  }

  it("makes a session and never a device, labelled by product names only", async () => {
    const devices = await countOf("SELECT count(*) AS n FROM devices");
    const response = await webSignIn();
    const cookie = cookieOf(response, "__Host-session")!;
    const { accountId } = (await (
      await worker.fetch(`${BASE}/v1/me`, { headers: { cookie } })
    ).json()) as {
      accountId: string;
    };
    expect(await countOf("SELECT count(*) AS n FROM devices")).toBe(devices);
    expect(await countOf("SELECT count(*) AS n FROM devices WHERE account_id = ?", accountId)).toBe(
      0,
    );
    const row = await env.DB.prepare("SELECT kind, browser, os FROM sessions WHERE account_id = ?")
      .bind(accountId)
      .first();
    expect(row).toEqual({ kind: "web", browser: "Firefox", os: "Linux" });
  });

  it("signs a returning person in to the account they have", async () => {
    const person = newKennitala();
    const ids = [];
    for (const _ of [1, 2]) {
      const cookie = cookieOf(await webSignIn("kenni", { person }), "__Host-session")!;
      ids.push(
        (
          (await (await worker.fetch(`${BASE}/v1/me`, { headers: { cookie } })).json()) as {
            accountId: string;
          }
        ).accountId,
      );
    }
    expect(ids[0]).toBe(ids[1]);
  });

  it("refuses a state other than its flow's", async () => {
    const { location, flow } = await start();
    const back = await atProvider(location, "kenni");
    back.searchParams.set("state", "A".repeat(43));
    const response = await callback(back, flow);
    expect(response.status).toBe(400);
    expect(cookieOf(response, "__Host-session")).toBeUndefined();
  });

  it("refuses a callback without its flow cookie, so without its verifier", async () => {
    const { location } = await start();
    const response = await callback(await atProvider(location, "kenni"), undefined);
    expect(response.status).toBe(400);
  });

  it("redeems with the flow's own verifier: another flow's cookie and state do not pass", async () => {
    const first = await start();
    const second = await start();
    const back = await atProvider(first.location, "kenni");
    back.searchParams.set("state", new URL(second.location).searchParams.get("state")!);
    const response = await callback(back, second.flow);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "sign_in_failed" });
  });

  it("refuses a flow cookie for the other provider, or one it did not seal", async () => {
    const { location, flow } = await start("google");
    const back = await atProvider(location, "google");
    const kenni = new URL(`${WEB}/auth/kenni/callback${back.search}`);
    expect((await callback(kenni, flow)).status).toBe(400);
    const forged = `__Host-sign-in=${flow!.split("=")[1]!.replace(/^./, (c) => (c === "A" ? "B" : "A"))}`;
    expect((await callback(back, forged)).status).toBe(400);
  });

  it("spends the flow: the cookie is cleared, and a replayed callback is refused", async () => {
    const { location, flow } = await start();
    const back = await atProvider(location, "kenni");
    const first = await callback(back, flow);
    expect(first.status).toBe(303);
    const cleared = first.headers.getSetCookie().find((c) => c.startsWith("__Host-sign-in="))!;
    expect(cleared).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/);
    // The code is spent at the provider too, so the same callback cannot sign in again.
    expect((await callback(back, flow)).status).toBe(403);
  });

  it("is a session the Origin check holds like any other", async () => {
    const cookie = cookieOf(await webSignIn(), "__Host-session")!;
    const post = (origin?: string) =>
      worker.fetch(`${BASE}/v1/me/invite`, {
        method: "POST",
        headers: { cookie, ...(origin ? { origin } : {}) },
      });
    expect((await post("https://evil.example")).status).toBe(403);
    expect((await post()).status).toBe(403);
    expect((await post(WEB)).status).toBe(200);
  });
});
