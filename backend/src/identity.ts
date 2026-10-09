import { type IdentityProvider, identityProvider, type ProviderName } from "./env/index.ts";
import { log } from "./log.ts";

// The identity providers, Kenni (decision 0019) and Google (decision 0033).
// The app runs the authorization; the Worker redeems the code and checks the
// ID token itself, so nothing a client says about who it is counts.

/**
 * Who a provider says signed in: Kenni's kennitala or Google's `sub`, and the
 * name it gave. Never logged (decision 0008); Google's email is not even read.
 */
export type Person = { provider: ProviderName; subject: string; name: string | null };

/** Why a sign-in failed. Opaque codes, safe to log. */
type SignInFailure =
  | "discovery_failed"
  | "code_rejected"
  | "token_malformed"
  | "signature_invalid"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "token_expired"
  | "nonce_mismatch"
  | "no_national_id"
  | "no_subject"
  | "email_unverified";

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
};

type Jwk = JsonWebKey & { kid?: string };

/** Discovery and keys per issuer, kept for an hour in this isolate. */
const cache = new Map<string, { discovery: Discovery; keys: Jwk[]; at: number }>();
const FRESH_MS = 60 * 60 * 1000;
/** An unknown `kid` refetches the keys, but not more often than this. */
const REFETCH_MS = 30 * 1000;
/** Clock skew allowed on `exp` and `iat`. */
const SKEW_S = 60;

async function json<T>(idp: IdentityProvider, url: string): Promise<T> {
  const response = await idp.fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

async function load(idp: IdentityProvider, now: number) {
  const discovery = await json<Discovery>(idp, `${idp.issuer}/.well-known/openid-configuration`);
  if (discovery.issuer !== idp.issuer) throw new Error("issuer");
  const { keys } = await json<{ keys: Jwk[] }>(idp, discovery.jwks_uri);
  const entry = { discovery, keys, at: now };
  cache.set(idp.issuer, entry);
  return entry;
}

/** The issuer's discovery document and keys, cached. */
async function provider(idp: IdentityProvider, now = Date.now()) {
  const cached = cache.get(idp.issuer);
  if (cached && now - cached.at < FRESH_MS) return cached;
  return load(idp, now);
}

/** What `GET /v1/sign-in` hands the app. */
export async function signInConfig(idp: IdentityProvider) {
  const { discovery } = await provider(idp);
  return {
    authorizationEndpoint: discovery.authorization_endpoint,
    clientId: idp.clientId,
    redirectUri: idp.redirectUri,
    scope: idp.scope,
  };
}

const decoder = new TextDecoder();

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function part<T>(text: string | undefined): T | null {
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    return JSON.parse(decoder.decode(fromBase64url(text))) as T;
  } catch {
    return null;
  }
}

type Claims = {
  iss?: unknown;
  aud?: unknown;
  azp?: unknown;
  exp?: unknown;
  iat?: unknown;
  nonce?: unknown;
  sub?: unknown;
  national_id?: unknown;
  audkenni_name?: unknown;
  email_verified?: unknown;
  name?: unknown;
};

async function verifySignature(idp: IdentityProvider, token: string, now: number) {
  const [head, body, signature] = token.split(".");
  const header = part<{ alg?: string; kid?: string }>(head);
  if (!header || !body || !signature || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    return "token_malformed" as const;
  }
  // Only RS256: an `alg` the token picks for itself is never trusted. The
  // token names its key, so a rollover never checks it against another one.
  if (header.alg !== "RS256" || typeof header.kid !== "string") {
    return "signature_invalid" as const;
  }

  let entry = await provider(idp, now);
  const find = () => entry.keys.find((k) => k.kty === "RSA" && k.kid === header.kid);
  let jwk = find();
  if (!jwk && now - entry.at >= REFETCH_MS) {
    entry = await load(idp, now);
    jwk = find();
  }
  if (!jwk) return "signature_invalid" as const;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signed = new TextEncoder().encode(`${head}.${body}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    fromBase64url(signature),
    signed,
  );
  return valid ? null : ("signature_invalid" as const);
}

/** `iss`, `aud` and `azp`: the token is from this issuer, for this client. */
function checkParties(idp: IdentityProvider, claims: Claims): SignInFailure | null {
  if (typeof claims.iss !== "string" || !idp.issuers.includes(claims.iss)) {
    return "issuer_mismatch";
  }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(idp.clientId)) return "audience_mismatch";
  if (audiences.length > 1 && claims.azp !== idp.clientId) return "audience_mismatch";
  return null;
}

/** `exp` and `iat`: the token is current, allowing for clock skew. */
function checkTimes(claims: Claims, now: number): SignInFailure | null {
  const seconds = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S <= seconds) return "token_expired";
  if (typeof claims.iat === "number" && claims.iat - SKEW_S > seconds) return "token_expired";
  return null;
}

/**
 * Checks an ID token as OpenID Connect Core § 3.1.3.7 asks of a client: the
 * signature against the issuer's keys, then `iss`, `aud` (and `azp` when
 * there are several audiences), `exp`, `iat` and the `nonce` the app made.
 */
async function verifyIdToken(
  idp: IdentityProvider,
  token: string,
  nonce: string,
  now = Date.now(),
): Promise<{ ok: Person } | { error: SignInFailure }> {
  const signature = await verifySignature(idp, token, now);
  if (signature) return { error: signature };
  const claims = part<Claims>(token.split(".")[1]);
  if (!claims) return { error: "token_malformed" };
  const failure = checkParties(idp, claims) ?? checkTimes(claims, now);
  if (failure) return { error: failure };
  if (claims.nonce !== nonce) return { error: "nonce_mismatch" };
  return idp.name === "kenni" ? kenniPerson(claims) : googlePerson(claims);
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "") || null;

/** Kenni: the kennitala, and the registry's name. */
function kenniPerson(claims: Claims): { ok: Person } | { error: SignInFailure } {
  if (typeof claims.national_id !== "string" || !/^\d{10}$/.test(claims.national_id)) {
    return { error: "no_national_id" };
  }
  return {
    ok: { provider: "kenni", subject: claims.national_id, name: text(claims.audkenni_name) },
  };
}

/**
 * Google: the `sub`, and the name on the Google account. The address must be
 * one Google verified; that is the only email check (decision 0033).
 */
function googlePerson(claims: Claims): { ok: Person } | { error: SignInFailure } {
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) {
    return { error: "no_subject" };
  }
  if (claims.email_verified !== true) return { error: "email_unverified" };
  return { ok: { provider: "google", subject: claims.sub, name: text(claims.name) } };
}

/**
 * Redeems an authorization code at the token endpoint (RFC 7636: the verifier
 * proves this is the app that asked) and verifies the ID token it returns.
 */
async function redeem(
  idp: IdentityProvider,
  code: { code: string; verifier: string; redirectUri: string; nonce: string },
): Promise<{ ok: Person } | { error: SignInFailure }> {
  let tokenEndpoint: string;
  try {
    tokenEndpoint = (await provider(idp)).discovery.token_endpoint;
  } catch {
    return { error: "discovery_failed" };
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: code.code,
    redirect_uri: code.redirectUri,
    code_verifier: code.verifier,
    client_id: idp.clientId,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (idp.clientSecret) {
    // RFC 6749 § 2.3.1: both halves form-encoded before Basic, which matters
    // for a client id that starts with `@` and holds a `/`.
    const pair = `${encodeURIComponent(idp.clientId)}:${encodeURIComponent(idp.clientSecret)}`;
    headers.authorization = `Basic ${btoa(pair)}`;
  }

  const response = await idp.fetch(tokenEndpoint, { method: "POST", headers, body: form });
  if (!response.ok) return { error: "code_rejected" };
  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (typeof body?.id_token !== "string") return { error: "token_malformed" };
  return verifyIdToken(idp, body.id_token, code.nonce);
}

export const unavailable = (name: ProviderName) =>
  name === "kenni" ? ("kenni_unavailable" as const) : ("google_unavailable" as const);

/**
 * Redeems a browser sign-in's code at its provider and checks the ID token
 * (decisions 0019, 0033): the person it names, or why not. Only the
 * provider's own redirect counts; a code issued for any other is not this
 * app's.
 */
export async function authorized(
  env: Env,
  body: {
    provider: ProviderName;
    code: string;
    codeVerifier: string;
    redirectUri: string;
    nonce: string;
  },
): Promise<
  { ok: Person } | { error: "sign_in_failed" | "kenni_unavailable" | "google_unavailable" }
> {
  const idp = identityProvider(env, body.provider);
  if (!idp) return { error: unavailable(body.provider) };
  if (body.redirectUri !== idp.redirectUri) return { error: "sign_in_failed" };
  const person = await redeem(idp, {
    code: body.code,
    verifier: body.codeVerifier,
    redirectUri: body.redirectUri,
    nonce: body.nonce,
  });
  if ("ok" in person) return person;
  log("sign_in.failed", { code: person.error, provider: body.provider });
  return person.error === "discovery_failed"
    ? { error: unavailable(body.provider) }
    : { error: "sign_in_failed" };
}
