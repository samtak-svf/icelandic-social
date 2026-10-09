import { env } from "cloudflare:workers";
import { randomToken, tokenHash } from "../src/accounts.ts";
import { base64url, toBase64 } from "../src/bytes.ts";
import { worker } from "./main.ts";

// Signing in as an app does (decision 0019): the authorize URL from
// /v1/sign-in, the fake Kenni's redirect, then POST /v1/devices.

const BASE = "https://spjall.test";
const fetch = (path: string, init?: RequestInit) => worker.fetch(`${BASE}${path}`, init);

const WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];
let people = 0;

/**
 * A new person's kennitala, born on a day in 2099: structurally valid, so it
 * passes as Kenni's, and nobody's. Computed rather than written out, because
 * tooling/pii-guard.mjs refuses a valid kennitala in any file.
 */
export function newKennitala(): string {
  for (;;) {
    const n = people++;
    const day = String(1 + (n % 28)).padStart(2, "0");
    const month = String(1 + (Math.floor(n / 28) % 12)).padStart(2, "0");
    const serial = String(20 + (Math.floor(n / 336) % 80)).padStart(2, "0");
    const first = `${day}${month}99${serial}`;
    const sum = WEIGHTS.reduce((acc, w, i) => acc + w * Number(first[i]), 0);
    const remainder = sum % 11;
    if (remainder === 1) continue;
    return `${first}${remainder === 0 ? 0 : 11 - remainder}0`;
  }
}

/** An invite in D1, as step 3's routes and the operator script will write one. */
export async function invite({
  inviter = null as string | null,
  singleUse = false,
  revoked = false,
} = {}) {
  const token = randomToken("");
  await env.DB.prepare(
    `INSERT INTO invites (token_hash, inviter_account_id, single_use, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      await tokenHash(token),
      inviter,
      singleUse ? 1 : 0,
      Date.now(),
      revoked ? Date.now() : null,
    )
    .run();
  return token;
}

const random = (bytes = 32) => base64url(crypto.getRandomValues(new Uint8Array(bytes)));

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

type SignIn = {
  kennitala?: string;
  name?: string;
  inviteToken?: string;
  /** Merged over the fake's ID-token claims. */
  claims?: Record<string, unknown>;
  /** Sign the ID token with a key Kenni does not publish, or name no key. */
  sign?: "wrong" | "nokid";
  /** What POST /v1/devices is sent, over what the app would send. */
  register?: Record<string, unknown>;
};

/** The authorization code for a person, as the fake Kenni redirects with it. */
export async function authorize(options: SignIn = {}) {
  const config = (await (await fetch("/v1/sign-in")).json()) as {
    authorizationEndpoint: string;
    clientId: string;
    redirectUri: string;
    scope: string;
  };
  const verifier = random();
  const nonce = random();
  const state = random(16);
  const url = new URL(config.authorizationEndpoint);
  const params: Record<string, string> = {
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scope,
    state,
    nonce,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
    login_hint: options.kennitala ?? newKennitala(),
  };
  if (options.name !== undefined) params.x_name = options.name;
  if (options.claims) params.x_claims = JSON.stringify(options.claims);
  if (options.sign) params.x_sign = options.sign;
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const redirect = await worker.fetch(url.toString(), { redirect: "manual" });
  const back = new URL(redirect.headers.get("location") ?? "");
  if (back.searchParams.get("state") !== state) throw new Error("state not returned");
  return {
    code: back.searchParams.get("code") ?? "",
    verifier,
    nonce,
    redirectUri: config.redirectUri,
  };
}

/** A whole sign-in: the response of POST /v1/devices. */
export async function signIn(options: SignIn = {}) {
  const { code, verifier, nonce, redirectUri } = await authorize(options);
  const body = {
    kenniCode: code,
    codeVerifier: verifier,
    redirectUri,
    nonce,
    platform: "android",
    deviceKey: toBase64(crypto.getRandomValues(new Uint8Array(32))),
    ...(options.inviteToken ? { inviteToken: options.inviteToken } : {}),
    ...options.register,
  };
  return registerWith(body);
}

export function registerWith(body: unknown) {
  return fetch("/v1/devices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
