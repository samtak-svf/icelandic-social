import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import ids from "../../../identifiers/ids.json" with { type: "json" };
import type { AppEnv } from "../http.ts";
import { base64url } from "../bytes.ts";
import {
  kennitalaKeys,
  type ProviderName,
  webIdentityProvider,
  withinLimit,
} from "../env/index.ts";
import { fail } from "../errors.ts";
import { log } from "../log.ts";
import { enrol, randomToken } from "./accounts.ts";
import type { Caller, Linked } from "./linking.ts";
import { authorizationUrl, type Person, unavailable, webAuthorized } from "./providers.ts";
import {
  browserSession,
  IDLE_MS,
  newBrowserSession,
  SESSION_COOKIE,
  SESSION_SECRET,
  sessionCookie,
  sessionForSecret,
  sessionLabel,
} from "./sessions.ts";

// Web sign-in (decisions 0061, 0062): the Worker runs the whole authorization
// code flow, so the browser never sees a code verifier or an ID token. The
// start route keeps the request's state, nonce and verifier in a sealed
// `__Host-` cookie and sends the browser to the provider; the callback on the
// web host checks the cookie against what came back and redeems the code.
// Google signs the person in by the same rules as the apps and sets the
// session cookie; a browser gets a session and never a device. Kenni is no
// way in (decisions 0035, 0069): it links to the account of the signed-in
// session that started the flow, and joins an older Kenni account as the
// apps' link does.

/** The cookie that holds one sign-in's flow until its callback. */
const FLOW_COOKIE = "sign-in";
/** How long a person has at the provider before the flow is refused. */
const FLOW_MS = 10 * 60 * 1000;

type Flow = {
  provider: ProviderName;
  /** The browser session a Kenni flow links for; a Google flow has none. */
  sessionId?: string;
  state: string;
  nonce: string;
  verifier: string;
  next: string;
  expires: number;
};

const encoder = new TextEncoder();

/**
 * The key the flow cookie is sealed with: derived from the kennitala HMAC key,
 * the one secret every Worker that signs anyone in has, under its own label so
 * it is useless for anything else. A rotation of that key fails only the
 * flows started in the ten minutes before it.
 */
async function flowKey(env: Env) {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(kennitalaKeys(env).key),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: encoder.encode("web sign-in flow"),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function seal(env: Env, flow: Flow): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await flowKey(env),
    encoder.encode(JSON.stringify(flow)),
  );
  return `${base64url(iv)}.${base64url(new Uint8Array(sealed))}`;
}

const fromBase64url = (text: string) =>
  Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));

/** The flow a cookie seals, or null for one this Worker did not seal. */
async function unseal(env: Env, cookie: string): Promise<Flow | null> {
  const [iv, sealed] = cookie.split(".");
  if (!iv || !sealed || !/^[A-Za-z0-9_-]+$/.test(iv + sealed)) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(iv) },
      await flowKey(env),
      fromBase64url(sealed),
    );
    return JSON.parse(new TextDecoder().decode(plain)) as Flow;
  } catch {
    return null;
  }
}

/**
 * Where the browser goes once signed in: a path on the web host, and nothing
 * else. `//host` and `/\host` are other hosts to a browser, so they are
 * refused with every absolute URL.
 */
const SAME_ORIGIN_PATH = /^\/(?![/\\])[\x21-\x7e]*$/;

/**
 * Links a Kenni person to the caller's account, joining an older account as
 * POST /v1/me/identities with merge does, and deletes the account a join
 * leaves empty. The app passes it in, since deleting an account reaches every
 * module and lives above them.
 */
export type LinkOrJoin = (
  env: Env,
  caller: Caller,
  person: Person,
  requestId: string,
) => Promise<{ ok: Linked } | { error: "identity_taken" | "already_linked" }>;

/** The browser's live session, or null; a renewal reaches the cookie too. */
async function signedIn(c: Context<AppEnv>) {
  const secret = getCookie(c, SESSION_COOKIE, "host");
  if (!secret || !SESSION_SECRET.test(secret)) return null;
  const found = await sessionForSecret(c.env, secret);
  if (!found) return null;
  if (found.renewed) setCookie(c, SESSION_COOKIE, secret, sessionCookie(found.renewed));
  return found.session;
}

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  return base64url(new Uint8Array(digest));
}

async function start(c: Context<AppEnv>, name: ProviderName) {
  const address = c.req.header("cf-connecting-ip");
  if (address && !(await withinLimit(c.env, "public", address))) {
    log("request.rate_limited", { code: "public", requestId: c.var.requestId });
    return fail(c, 429, "rate_limited");
  }
  const next = c.req.query("next") ?? "/";
  if (!SAME_ORIGIN_PATH.test(next)) return fail(c, 400, "invalid_request");
  const idp = webIdentityProvider(c.env, name);
  if (!idp) return fail(c, 503, unavailable(name));
  // Kenni only adds the mark to a signed-in account (decision 0069).
  const session = name === "kenni" ? await signedIn(c) : null;
  if (name === "kenni" && !session) return fail(c, 401, "unauthorized");
  const flow: Flow = {
    provider: name,
    ...(session ? { sessionId: session.sessionId } : {}),
    state: randomToken(""),
    nonce: randomToken(""),
    verifier: randomToken(""),
    next,
    expires: Date.now() + FLOW_MS,
  };
  let location: string;
  try {
    location = await authorizationUrl(idp, { ...flow, challenge: await challenge(flow.verifier) });
  } catch {
    log("sign_in.failed", { code: "discovery_failed", provider: name, requestId: c.var.requestId });
    return fail(c, 503, unavailable(name));
  }
  setCookie(c, FLOW_COOKIE, await seal(c.env, flow), sessionCookie(flow.expires));
  c.header("cache-control", "no-store");
  return c.redirect(location, 302);
}

/** The flow this callback belongs to, or null: the cookie is spent either way. */
async function flowOf(c: Context<AppEnv>, name: ProviderName) {
  const cookie = getCookie(c, FLOW_COOKIE, "host");
  deleteCookie(c, FLOW_COOKIE, sessionCookie(0));
  const flow = cookie ? await unseal(c.env, cookie) : null;
  const state = c.req.query("state");
  const fresh = flow && flow.provider === name && flow.expires > Date.now();
  return fresh && state === flow.state ? flow : null;
}

/**
 * The callback, limited per address like every route reached before signing
 * in. A code is redeemed only for the flow whose cookie came back with its
 * `state`, with that flow's verifier and nonce.
 */
async function callback(c: Context<AppEnv>, name: ProviderName, link: LinkOrJoin) {
  const address = c.req.header("cf-connecting-ip");
  if (address && !(await withinLimit(c.env, "public", address))) {
    log("request.rate_limited", { code: "public", requestId: c.var.requestId });
    return fail(c, 429, "rate_limited");
  }
  const flow = await flowOf(c, name);
  const code = c.req.query("code");
  if (!flow || !code) {
    log("sign_in.failed", { code: "flow_mismatch", provider: name, requestId: c.var.requestId });
    return fail(c, 400, "invalid_request");
  }
  const idp = webIdentityProvider(c.env, name);
  if (!idp) return fail(c, 503, unavailable(name));
  // The session that started a Kenni flow must still be the browser's.
  const caller = name === "kenni" ? await signedIn(c) : null;
  if (name === "kenni" && caller?.sessionId !== flow.sessionId) {
    log("sign_in.failed", { code: "session_mismatch", provider: name, requestId: c.var.requestId });
    return fail(c, 401, "unauthorized");
  }
  const person = await webAuthorized(idp, { code, verifier: flow.verifier, nonce: flow.nonce });
  if ("error" in person) {
    return person.error === "sign_in_failed"
      ? fail(c, 403, person.error)
      : fail(c, 503, person.error);
  }
  if (caller) {
    const linked = await link(c.env, caller, person.ok, c.var.requestId);
    const verify = "error" in linked ? "taken" : linked.ok.merged ? "merged" : "linked";
    c.header("cache-control", "no-store");
    return c.redirect(withQuery(flow.next, "verify", verify), 303);
  }
  const session = {
    ...(await newBrowserSession()),
    ...sessionLabel(c.req.header("user-agent")),
  };
  const accountId = await enrol(c.env, person.ok, undefined, (account, now) => [
    browserSession(c.env, session, account, now),
  ]);
  log("session.created", { accountId, sessionId: session.sessionId, requestId: c.var.requestId });
  setCookie(c, SESSION_COOKIE, session.secret, sessionCookie(Date.now() + IDLE_MS));
  c.header("cache-control", "no-store");
  return c.redirect(flow.next, 303);
}

/** A same-origin path with one more query parameter. */
function withQuery(path: string, key: string, value: string) {
  const url = new URL(path, "https://web.invalid");
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}`;
}

/** The web's sign-in routes, outside the API and its contract. */
export function webSignInRoutes(link: LinkOrJoin) {
  const routes = new Hono<AppEnv>();
  for (const name of ["kenni", "google"] as const) {
    routes.get(`/auth/${name}/start`, (c) => start(c, name));
    routes.get(ids.hosts.webSignInCallbacks[name], (c) => callback(c, name, link));
  }
  return routes;
}
