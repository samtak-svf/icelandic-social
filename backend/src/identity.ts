import type { Kenni } from "./env/index.ts";

// Kenni, the identity provider (decision 0019). The app runs the
// authorization; the Worker redeems the code and checks the ID token itself,
// so nothing a client says about who it is counts.

/** The scopes every sign-in asks for: the kennitala and the registry's name. */
const SCOPE = "openid national_id audkenni_name";

/** Who Kenni says signed in. Never logged (decision 0008). */
export type Person = { nationalId: string; name: string | null };

/** Why a sign-in failed. Opaque codes, safe to log. */
export type SignInFailure =
  | "discovery_failed"
  | "code_rejected"
  | "token_malformed"
  | "signature_invalid"
  | "issuer_mismatch"
  | "audience_mismatch"
  | "token_expired"
  | "nonce_mismatch"
  | "no_national_id";

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

async function json<T>(kenni: Kenni, url: string): Promise<T> {
  const response = await kenni.fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status}`);
  return (await response.json()) as T;
}

async function load(kenni: Kenni, now: number) {
  const discovery = await json<Discovery>(
    kenni,
    `${kenni.issuer}/.well-known/openid-configuration`,
  );
  if (discovery.issuer !== kenni.issuer) throw new Error("issuer");
  const { keys } = await json<{ keys: Jwk[] }>(kenni, discovery.jwks_uri);
  const entry = { discovery, keys, at: now };
  cache.set(kenni.issuer, entry);
  return entry;
}

/** The issuer's discovery document and keys, cached. */
async function provider(kenni: Kenni, now = Date.now()) {
  const cached = cache.get(kenni.issuer);
  if (cached && now - cached.at < FRESH_MS) return cached;
  return load(kenni, now);
}

/** What `GET /v1/sign-in` hands the app. */
export async function signInConfig(kenni: Kenni) {
  const { discovery } = await provider(kenni);
  return {
    authorizationEndpoint: discovery.authorization_endpoint,
    clientId: kenni.clientId,
    redirectUri: kenni.redirectUri,
    scope: SCOPE,
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
  national_id?: unknown;
  audkenni_name?: unknown;
};

async function verifySignature(kenni: Kenni, token: string, now: number) {
  const [head, body, signature] = token.split(".");
  const header = part<{ alg?: string; kid?: string }>(head);
  if (!header || !body || !signature || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    return "token_malformed" as const;
  }
  // Only RS256: an `alg` the token picks for itself is never trusted.
  if (header.alg !== "RS256") return "signature_invalid" as const;

  let entry = await provider(kenni, now);
  const find = () =>
    entry.keys.find((k) => k.kty === "RSA" && (header.kid === undefined || k.kid === header.kid));
  let jwk = find();
  if (!jwk && now - entry.at >= REFETCH_MS) {
    entry = await load(kenni, now);
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
function checkParties(kenni: Kenni, claims: Claims): SignInFailure | null {
  if (claims.iss !== kenni.issuer) return "issuer_mismatch";
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(kenni.clientId)) return "audience_mismatch";
  if (audiences.length > 1 && claims.azp !== kenni.clientId) return "audience_mismatch";
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
  kenni: Kenni,
  token: string,
  nonce: string,
  now = Date.now(),
): Promise<{ ok: Person } | { error: SignInFailure }> {
  const signature = await verifySignature(kenni, token, now);
  if (signature) return { error: signature };
  const claims = part<Claims>(token.split(".")[1]);
  if (!claims) return { error: "token_malformed" };
  const failure = checkParties(kenni, claims) ?? checkTimes(claims, now);
  if (failure) return { error: failure };
  if (claims.nonce !== nonce) return { error: "nonce_mismatch" };
  if (typeof claims.national_id !== "string" || !/^\d{10}$/.test(claims.national_id)) {
    return { error: "no_national_id" };
  }
  const name = typeof claims.audkenni_name === "string" ? claims.audkenni_name.trim() : "";
  return { ok: { nationalId: claims.national_id, name: name || null } };
}

/**
 * Redeems an authorization code at the token endpoint (RFC 7636: the verifier
 * proves this is the app that asked) and verifies the ID token it returns.
 */
export async function redeem(
  kenni: Kenni,
  code: { code: string; verifier: string; redirectUri: string; nonce: string },
): Promise<{ ok: Person } | { error: SignInFailure }> {
  let tokenEndpoint: string;
  try {
    tokenEndpoint = (await provider(kenni)).discovery.token_endpoint;
  } catch {
    return { error: "discovery_failed" };
  }

  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: code.code,
    redirect_uri: code.redirectUri,
    code_verifier: code.verifier,
    client_id: kenni.clientId,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (kenni.clientSecret) {
    // RFC 6749 § 2.3.1: both halves form-encoded before Basic, which matters
    // for a client id that starts with `@` and holds a `/`.
    const pair = `${encodeURIComponent(kenni.clientId)}:${encodeURIComponent(kenni.clientSecret)}`;
    headers.authorization = `Basic ${btoa(pair)}`;
  }

  const response = await kenni.fetch(tokenEndpoint, { method: "POST", headers, body: form });
  if (!response.ok) return { error: "code_rejected" };
  const body = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  if (typeof body?.id_token !== "string") return { error: "token_malformed" };
  return verifyIdToken(kenni, body.id_token, code.nonce);
}
