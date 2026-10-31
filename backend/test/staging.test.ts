import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GATE_COOKIE, GATE_HEADER, GATE_PATH, gated, stagingFetch } from "../dev/staging-app.ts";
import { euEnv } from "./support.ts";
import packageJson from "../../web/package.json" with { type: "json" };

// Staging's gate (decision 0118): nothing runs without it, and it fails closed.

const SECRET = "a-staging-gate-of-at-least-32-characters";
const ORIGIN = "https://staging.test";
const PROD = "https://spjall.samtak.is";
/** The paths that matter most behind it: the fakes, the API, the web, a static file. */
const PATHS = [
  "/",
  "/health",
  "/v1/me",
  "/auth/google/start",
  "/dev/google/.well-known/openid-configuration",
  "/dev/kenni/oidc/jwks",
  "/assets/index.js",
];

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

let reached: string[] = [];
let webCalls = 0;

/** What the app would serve, counted, so a test sees whether anything ran. */
const web = () => {
  webCalls++;
  return new Response("web");
};

/** The env a staging Worker has, with the given gate. */
const stagingEnv = (secret: string | undefined) =>
  ({
    ...euEnv(env),
    STAGING_GATE: secret,
    ASSETS: {
      fetch: async (request: Request) => {
        reached.push(new URL(request.url).pathname);
        return new URL(request.url).pathname === "/assets/index.js"
          ? new Response("asset")
          : new Response(null, { status: 404 });
      },
    },
  }) as unknown as Env;

const call = (
  path: string,
  secret: string | undefined,
  headers: Record<string, string> = {},
  init: RequestInit = {},
) =>
  stagingFetch(
    new Request(`${ORIGIN}${path}`, { redirect: "manual", ...init, headers }),
    stagingEnv(secret),
    ctx,
    web,
  );

beforeEach(() => {
  reached = [];
  webCalls = 0;
});

/** The response is the gate's: empty, and nothing behind it ran. */
async function refused(response: Response) {
  expect(response.status).toBe(404);
  expect(await response.text()).toBe("");
  expect(reached).toEqual([]);
  expect(webCalls).toBe(0);
}

describe("staging's gate refuses", () => {
  it.each(PATHS)("a request without it: %s", async (path) => {
    await refused(await call(path, SECRET));
  });

  it.each(PATHS)("a wrong header: %s", async (path) => {
    await refused(await call(path, SECRET, { [GATE_HEADER]: `${SECRET}x` }));
  });

  it.each(PATHS)("a cookie that cannot be decoded: %s", async (path) => {
    await refused(await call(path, SECRET, { cookie: `${GATE_COOKIE}=%` }));
  });

  it.each(PATHS)("a wrong cookie: %s", async (path) => {
    await refused(await call(path, SECRET, { cookie: `${GATE_COOKIE}=wrong` }));
  });

  it.each(PATHS)("everything while the secret is unset: %s", async (path) => {
    await refused(await call(path, undefined, { [GATE_HEADER]: SECRET }));
    await refused(await call(path, "", { [GATE_HEADER]: "" }));
  });

  it("everything while the secret is too short to be one", async () => {
    await refused(await call("/health", "short", { [GATE_HEADER]: "short" }));
  });

  it("a method's and a body's way around it: nothing but the secret opens it", async () => {
    await refused(await call("/dev/jobs", SECRET, {}, { method: "POST" }));
    await refused(await call("/dev/operator-invite", SECRET, {}, { method: "POST" }));
    await refused(await call("/health", SECRET, { authorization: `Bearer ${SECRET}` }));
  });

  it("the gate's own URL with a wrong key, no key, or the secret unset", async () => {
    await refused(await call(`${GATE_PATH}?key=wrong`, SECRET));
    await refused(await call(GATE_PATH, SECRET));
    await refused(await call(`${GATE_PATH}?key=${SECRET}`, SECRET, {}, { method: "POST" }));
    await refused(await call(`${GATE_PATH}?key=${SECRET}`, undefined));
  });
});

describe("staging's gate lets through", () => {
  it("the right header, to the API, the web and a static file", async () => {
    const gate = { [GATE_HEADER]: SECRET };
    expect((await call("/health", SECRET, gate)).status).toBe(200);
    expect(await (await call("/assets/index.js", SECRET, gate)).text()).toBe("asset");
    expect(await (await call("/some-page", SECRET, gate)).text()).toBe("web");
    expect(webCalls).toBe(1);
  });

  it("the cookie its URL sets, which never leaves a browser's script or plain http", async () => {
    const opened = await call(`${GATE_PATH}?key=${SECRET}`, SECRET);
    expect(opened.status).toBe(303);
    expect(opened.headers.get("location")).toBe("/");
    expect(opened.headers.get("cache-control")).toBe("no-store");
    expect(opened.headers.get("referrer-policy")).toBe("no-referrer");
    const line = opened.headers.get("set-cookie") ?? "";
    expect(line).toMatch(/^__Host-staging-gate=.*; Path=\/; Secure; HttpOnly; SameSite=Lax$/);
    const cookie = line.split(";")[0] as string;
    expect((await call("/health", SECRET, { cookie })).status).toBe(200);
  });

  it("without the gate's header or cookie on what it hands on", async () => {
    let seen: Request | undefined;
    await gated(
      new Request(`${ORIGIN}/x`, {
        headers: { [GATE_HEADER]: SECRET, cookie: `a=1; ${GATE_COOKIE}=${SECRET}; b=2` },
      }),
      SECRET,
      (inner) => {
        seen = inner;
        return new Response();
      },
    );
    expect(seen?.headers.get(GATE_HEADER)).toBeNull();
    expect(seen?.headers.get("cookie")).toBe("a=1; b=2");
  });
});

describe("staging's sign-in", () => {
  const gate = { [GATE_HEADER]: SECRET, "spjall-client": `web/${packageJson.version}` };

  it("runs on the origin it was reached at, with the fake issuer, to a session", async () => {
    const started = await call("/auth/google/start?next=/", SECRET, gate);
    expect(started.status).toBe(302);
    const flow = started.headers.getSetCookie()[0]?.split(";")[0] as string;
    const at = new URL(started.headers.get("location") ?? "");
    expect(at.origin).toBe(ORIGIN);
    expect(at.pathname).toBe("/dev/google/oidc/auth");
    // The redirect the Worker names stays the production callback the grant
    // holds; only the browser's way back is moved.
    expect(at.searchParams.get("redirect_uri")).toBe(`${PROD}/auth/google/callback`);

    at.searchParams.set("login_hint", `staging${crypto.randomUUID().replaceAll("-", "")}`);
    const back = await call(`${at.pathname}${at.search}`, SECRET, gate);
    expect(back.status).toBe(302);
    const callback = new URL(back.headers.get("location") ?? "");
    expect(callback.origin).toBe(ORIGIN);

    const signed = await call(`${callback.pathname}${callback.search}`, SECRET, {
      ...gate,
      cookie: flow,
    });
    expect(signed.status).toBe(303);
    const session = signed.headers
      .getSetCookie()
      .find((line) => line.startsWith("__Host-session="))
      ?.split(";")[0];
    expect(session).toBeDefined();
    const me = await call("/v1/me", SECRET, { ...gate, cookie: session as string });
    expect(me.status).toBe(200);
  });

  it("accepts a cookie's state change from its own origin, and refuses another's", async () => {
    const change = (origin: string) =>
      call(
        "/v1/me/sessions/nothing",
        SECRET,
        { ...gate, origin, cookie: "__Host-session=x" },
        { method: "DELETE" },
      );
    const theirs = await (await change("https://elsewhere.example")).text();
    const mine = await (await change(ORIGIN)).text();
    expect(theirs).not.toBe(mine);
  });

  it("redeems a code in another isolate than the one that issued it", async () => {
    const url =
      `${ORIGIN}/dev/google/oidc/auth?client_id=fake-google-client&response_type=code&scope=openid` +
      `&redirect_uri=${encodeURIComponent(`${PROD}/oauth/google`)}&login_hint=isolate` +
      `&code_challenge=${await challenge("verifier")}&code_challenge_method=S256`;
    const issued = await (
      await import("../dev/oidc.ts")
    ).withFakes(new Request(url), stagingEnv(SECRET));
    const location = new URL((await issued.response)?.headers.get("location") ?? "");
    vi.resetModules();
    const fresh = await import("../dev/oidc.ts");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: location.searchParams.get("code") ?? "",
      client_id: "fake-google-client",
      redirect_uri: `${PROD}/oauth/google`,
      code_verifier: "verifier",
    });
    const redeem = () =>
      fresh.withFakes(
        new Request(`${ORIGIN}/dev/google/oidc/token`, { method: "POST", body }),
        stagingEnv(SECRET),
      ).response;
    expect((await redeem())?.status).toBe(200);
    expect((await redeem())?.status).toBe(400);
  });
});

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
