import { env } from "cloudflare:workers";
import { expect } from "vitest";
import { createApp } from "../../../src/app.ts";
import { CLIENT_HEADER } from "../../../src/shared/client-version.ts";
import type { Person } from "../../people.ts";
import { euEnv } from "../../support.ts";

// An exporter registered for direct transfers (decision 0129), and the steps it takes: send
// a person to consent, trade the code for tokens, refresh them. Hand-written; no network.

const BASE = "https://spjall.test";
export const REDIRECT = "https://exporter.example/callback";
export const CLIENT_ID = "exporter-1";
const CLIENT_SECRET = "exporter-secret-value";

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/** The environment with the exporter registered, or `off` with none. */
export async function transferEnv(on = true): Promise<Env> {
  const client = {
    id: CLIENT_ID,
    name: "Exporter",
    secretSha256: await sha256Hex(CLIENT_SECRET),
    redirectUris: [REDIRECT],
    source: "platform-a",
  };
  return {
    ...euEnv(env),
    ...(on ? { TRANSFER_CLIENT: JSON.stringify(client) } : {}),
  } as unknown as Env;
}

export async function call(E: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return await createApp().fetch(new Request(`${BASE}${path}`, { redirect: "manual", ...init }), E);
}

/** A call as `who`, through the app with `E`. */
export function as(E: Env, who: Person, method: string, path: string, body?: unknown) {
  return call(E, path, {
    method,
    headers: {
      ...who.auth,
      [CLIENT_HEADER]: `android/${env.MIN_CLIENT_VERSION_ANDROID}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const basic = (id = CLIENT_ID, secret = CLIENT_SECRET) =>
  `Basic ${btoa(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`)}`;

export function token(E: Env, form: Record<string, string>, auth = basic()): Promise<Response> {
  return call(E, "/oauth/token", {
    method: "POST",
    headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
}

/** Sends the person to consent and returns the request id the consent screen shows. */
export async function authorize(E: Env, query: Record<string, string> = {}): Promise<string> {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT,
    scope: "social-posts media",
    state: "s-1",
    ...query,
  });
  const response = await call(E, `/oauth/authorize?${params}`);
  expect(response.status).toBe(302);
  const location = response.headers.get("location") ?? "";
  const id = /^\/transfer\/(tr_[0-9a-f]+)$/.exec(location)?.[1];
  expect(id).toBeDefined();
  return id as string;
}

/** The code `who` gets by approving a request. */
export async function consent(E: Env, who: Person, query: Record<string, string> = {}) {
  const requestId = await authorize(E, query);
  const response = await as(E, who, "POST", `/v1/transfer-requests/${requestId}/approve`);
  expect(response.status).toBe(200);
  const redirect = new URL(((await response.json()) as { redirect: string }).redirect);
  expect(redirect.origin + redirect.pathname).toBe(REDIRECT);
  expect(redirect.searchParams.get("state")).toBe("s-1");
  return redirect.searchParams.get("code") as string;
}

export type Tokens = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
};

/** Consent and code exchange: the tokens an exporter holds for `who`. */
export async function connect(E: Env, who: Person): Promise<Tokens> {
  const code = await consent(E, who);
  const response = await token(E, {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as Tokens;
}
