import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.ts";
import { newKennitala, newSubject, signIn } from "../oidc.ts";
import { worker } from "../main.ts";

// Web sign-in (decisions 0061, 0062, 0069): the Worker runs the flow, and a
// browser signs in with Google and ends with a session cookie and no device.
// Kenni only adds the mark to the account a signed-in browser holds.

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
async function start(provider: Provider = "google", next?: string, session?: string) {
  const query = next === undefined ? "" : `?next=${encodeURIComponent(next)}`;
  const response = await worker.fetch(`${BASE}/auth/${provider}/start${query}`, {
    redirect: "manual",
    headers: session ? { cookie: session } : {},
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

function callback(back: URL, ...cookies: (string | undefined)[]) {
  const cookie = cookies.filter(Boolean).join("; ");
  return worker.fetch(`${BASE}${back.pathname}${back.search}`, {
    redirect: "manual",
    headers: { "user-agent": FIREFOX, ...(cookie ? { cookie } : {}) },
  });
}

/** A whole web sign-in with Google: the callback's response. */
async function webSignIn({ next, person }: { next?: string; person?: string } = {}) {
  const { location, flow } = await start("google", next);
  return callback(await atProvider(location, "google", person), flow);
}

/** A signed-in browser: its session cookie and account. */
async function browser(person?: string) {
  const session = cookieOf(await webSignIn({ person }), "__Host-session")!;
  return { session, accountId: (await meOf(session)).accountId };
}

async function meOf(session: string) {
  const me = await worker.fetch(`${BASE}/v1/me`, { headers: { cookie: session } });
  expect(me.status).toBe(200);
  return (await me.json()) as { accountId: string; verified: boolean };
}

/** The signed-in browser adds the mark with Kenni: the callback's response. */
async function addMark(
  session: string,
  { next, kennitala }: { next?: string; kennitala?: string } = {},
) {
  const { location, flow } = await start("kenni", next, session);
  return callback(await atProvider(location, "kenni", kennitala), flow, session);
}

const countOf = async (sql: string, ...bind: unknown[]) =>
  (await env.DB.prepare(sql)
    .bind(...bind)
    .first<{ n: number }>())!.n;

describe("the start", () => {
  it("sends the browser to the provider with PKCE, state and nonce, and seals the flow", async () => {
    const { session } = await browser();
    const { response, location, flow } = await start("kenni", "/c/abc", session);
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
      expect((await start("google", next)).response.status).toBe(400);
    }
    expect((await start("google", "/c/abc?x=1")).response.status).toBe(302);
  });

  it("starts no Kenni flow without a signed-in session: Kenni is no way in", async () => {
    for (const session of [undefined, `__Host-session=st_${"A".repeat(43)}`]) {
      const { response, flow } = await start("kenni", "/", session);
      expect(response.status).toBe(401);
      expect(flow).toBeUndefined();
    }
  });

  it("answers 503 for Kenni while its web client has no secret", async () => {
    const response = await createApp().fetch(new Request(`${BASE}/auth/kenni/start`), env);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "kenni_unavailable" });
  });
});

describe("the callback", () => {
  it("signs in with Google, sets the session cookie and returns to the asked path", async () => {
    const response = await webSignIn({ next: "/c/abc?x=1" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/c/abc?x=1");
    const line = response.headers.getSetCookie().find((c) => c.startsWith("__Host-session="))!;
    for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
      expect(line).toContain(attribute);
    expect(line).not.toContain("Domain");
    await meOf(cookieOf(response, "__Host-session")!);
  });

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
    const person = newSubject();
    expect((await browser(person)).accountId).toBe((await browser(person)).accountId);
  });

  it("refuses a state other than its flow's", async () => {
    const { location, flow } = await start();
    const back = await atProvider(location, "google");
    back.searchParams.set("state", "A".repeat(43));
    const response = await callback(back, flow);
    expect(response.status).toBe(400);
    expect(cookieOf(response, "__Host-session")).toBeUndefined();
  });

  it("refuses a callback without its flow cookie, so without its verifier", async () => {
    const { location } = await start();
    const response = await callback(await atProvider(location, "google"), undefined);
    expect(response.status).toBe(400);
  });

  it("redeems with the flow's own verifier: another flow's cookie and state do not pass", async () => {
    const first = await start();
    const second = await start();
    const back = await atProvider(first.location, "google");
    back.searchParams.set("state", new URL(second.location).searchParams.get("state")!);
    const response = await callback(back, second.flow);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "sign_in_failed" });
  });

  it("refuses a flow cookie for the other provider, or one it did not seal", async () => {
    const { location, flow } = await start();
    const back = await atProvider(location, "google");
    const kenni = new URL(`${WEB}/auth/kenni/callback${back.search}`);
    expect((await callback(kenni, flow)).status).toBe(400);
    const forged = `__Host-sign-in=${flow!.split("=")[1]!.replace(/^./, (c) => (c === "A" ? "B" : "A"))}`;
    expect((await callback(back, forged)).status).toBe(400);
  });

  it("spends the flow: the cookie is cleared, and a replayed callback is refused", async () => {
    const { location, flow } = await start();
    const back = await atProvider(location, "google");
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

describe("the Kenni callback", () => {
  const accounts = () => countOf("SELECT count(*) AS n FROM accounts");
  const providers = async (accountId: string) =>
    (
      await env.DB.prepare("SELECT provider FROM identities WHERE account_id = ? ORDER BY provider")
        .bind(accountId)
        .all<{ provider: string }>()
    ).results.map((r) => r.provider);

  it("adds the mark to the signed-in account and returns with verify=linked", async () => {
    const { session, accountId } = await browser();
    const before = await accounts();
    const response = await addMark(session, { next: "/me?tab=1" });
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/me?tab=1&verify=linked");
    expect(cookieOf(response, "__Host-session")).toBeUndefined();
    expect(await accounts()).toBe(before);
    expect(await providers(accountId)).toEqual(["google", "kenni"]);
    expect(await meOf(session)).toMatchObject({ accountId, verified: true });
  });

  it("joins an older Kenni account, and the browser's session moves with it", async () => {
    const kennitala = newKennitala();
    const older = await signIn({ kennitala });
    const { accountId: olderId } = (await older.json()) as { accountId: string };
    const { session, accountId } = await browser();
    const response = await addMark(session, { kennitala });
    expect(response.headers.get("location")).toBe("/?verify=merged");
    expect(await meOf(session)).toMatchObject({ accountId: olderId, verified: true });
    expect(await providers(olderId)).toEqual(["google", "kenni"]);
    expect(
      await countOf("SELECT count(*) AS n FROM accounts WHERE account_id = ?", accountId),
    ).toBe(0);
  });

  it("returns with verify=taken when another account with Google holds the kennitala", async () => {
    const kennitala = newKennitala();
    const first = await browser();
    expect((await addMark(first.session, { kennitala })).headers.get("location")).toBe(
      "/?verify=linked",
    );
    const second = await browser();
    expect((await addMark(second.session, { kennitala })).headers.get("location")).toBe(
      "/?verify=taken",
    );
    expect(await meOf(second.session)).toMatchObject({
      accountId: second.accountId,
      verified: false,
    });
  });

  it("makes no account, and acts for no other session than the one that started it", async () => {
    const { session } = await browser();
    const other = await browser();
    const before = await accounts();
    const { location, flow } = await start("kenni", "/", session);
    const back = await atProvider(location, "kenni");
    expect((await callback(back, flow)).status).toBe(401);
    const again = await start("kenni", "/", session);
    const backAgain = await atProvider(again.location, "kenni");
    expect((await callback(backAgain, again.flow, other.session)).status).toBe(401);
    expect(await accounts()).toBe(before);
    expect(await providers(other.accountId)).toEqual(["google"]);
  });
});
