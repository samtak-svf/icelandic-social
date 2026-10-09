import ids from "../../identifiers/ids.json" with { type: "json" };

// A fake Kenni (decision 0019): a real OpenID Connect provider for one client,
// the app's, mounted by dev/worker.ts and test/worker.ts under `/dev/kenni`.
// Never deployed: src/ does not import it, and `cf deploy` builds
// src/index.ts.
//
// It serves discovery, authorize, token and JWKS, signs ID tokens RS256 with a
// key it makes on first use, and checks PKCE (S256) and the redirect. There is
// no login: `login_hint` is the kennitala of the person who signs in, and a
// request without one gets a form asking for it. Tests bend the ID token with
// two extra authorize parameters:
// - `x_claims`: JSON merged over the claims, e.g. `{"aud":"someone-else"}`;
// - `x_sign=wrong`: sign with another key under the same `kid`;
// - `x_sign=nokid`: sign with the right key, but name no `kid`.

export const KENNI_PATH = "/dev/kenni";

const KID = "fake-kenni-1";
const CODE_TTL_MS = 60 * 1000;
const TOKEN_TTL_S = 300;

/** How the ID token is signed: as Kenni does, or bent for a test. */
const SIGNINGS = ["right", "wrong", "nokid"] as const;
type Signing = (typeof SIGNINGS)[number];

const signingOf = (asked: string | null): Signing =>
  SIGNINGS.find((how) => how === asked) ?? "right";

type Grant = {
  clientId: string;
  redirectUri: string;
  challenge: string;
  claims: Record<string, unknown>;
  signing: Signing;
  expires: number;
};

/** Issued codes, each redeemable once. */
const grants = new Map<string, Grant>();

type Keys = { signing: CryptoKeyPair; wrong: CryptoKeyPair; jwk: JsonWebKey };
let keys: Promise<Keys> | null = null;

// Workers forbid crypto at module scope, so the keys are made on first use.
function keyPair() {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  ) as Promise<CryptoKeyPair>;
}

function signingKeys(): Promise<Keys> {
  keys ??= (async () => {
    const [signing, wrong] = await Promise.all([keyPair(), keyPair()]);
    const jwk = (await crypto.subtle.exportKey("jwk", signing.publicKey)) as JsonWebKey;
    return { signing, wrong, jwk };
  })();
  return keys;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

async function sign(claims: Record<string, unknown>, how: Signing): Promise<string> {
  const { signing, wrong } = await signingKeys();
  const header = { alg: "RS256", typ: "JWT", ...(how !== "nokid" && { kid: KID }) };
  const input = `${encode(header)}.${encode(claims)}`;
  const key = (how === "wrong" ? wrong : signing).privateKey;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(input),
  );
  return `${input}.${base64url(new Uint8Array(signature))}`;
}

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

const oauthError = (error: string, status = 400) => Response.json({ error }, { status });

function form(url: URL): Response {
  const fields = [...url.searchParams]
    .filter(([name]) => name !== "login_hint")
    .map(([name, value]) => `<input type="hidden" name="${escape(name)}" value="${escape(value)}">`)
    .join("");
  const page = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Gervi-Kenni</title><h1>Gervi-Kenni</h1>
<form method="get">${fields}
<label>Kennitala <input name="login_hint" inputmode="numeric" pattern="\\d{10}" required></label>
<label>Nafn <input name="x_name"></label>
<button>Skrá inn</button></form>`;
  return new Response(page, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function authorize(url: URL, issuer: string): Promise<Response> {
  const q = url.searchParams;
  const clientId = q.get("client_id");
  const redirectUri = q.get("redirect_uri");
  if (clientId !== ids.identity.kenniClientId || !redirectUri) return oauthError("invalid_client");
  if (q.get("response_type") !== "code") return oauthError("unsupported_response_type");
  const challenge = q.get("code_challenge");
  if (!challenge || q.get("code_challenge_method") !== "S256") return oauthError("invalid_request");
  if (!q.get("scope")?.split(" ").includes("openid")) return oauthError("invalid_scope");

  const person = q.get("login_hint");
  if (!person) return form(url);
  if (!/^\d{10}$/.test(person)) return oauthError("invalid_request");

  const name = q.get("x_name") ?? "";
  const now = Math.floor(Date.now() / 1000);
  let overrides: Record<string, unknown> = {};
  try {
    overrides = JSON.parse(q.get("x_claims") ?? "{}") as Record<string, unknown>;
  } catch {
    return oauthError("invalid_request");
  }
  const claims = {
    iss: issuer,
    aud: clientId,
    sub: `fake-${person}`,
    iat: now,
    exp: now + TOKEN_TTL_S,
    nonce: q.get("nonce") ?? undefined,
    national_id: person,
    audkenni_name: name,
    name,
    ...overrides,
  };

  const code = base64url(crypto.getRandomValues(new Uint8Array(32)));
  grants.set(code, {
    clientId,
    redirectUri,
    challenge,
    claims,
    signing: signingOf(q.get("x_sign")),
    expires: Date.now() + CODE_TTL_MS,
  });
  const back = new URL(redirectUri);
  back.searchParams.set("code", code);
  const state = q.get("state");
  if (state !== null) back.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: back.toString() } });
}

async function token(request: Request): Promise<Response> {
  const body = await request.formData();
  if (body.get("grant_type") !== "authorization_code") {
    return oauthError("unsupported_grant_type");
  }
  const code = String(body.get("code") ?? "");
  const grant = grants.get(code);
  // A code is spent on its first redemption, whatever the outcome.
  grants.delete(code);
  if (!grant || grant.expires < Date.now()) return oauthError("invalid_grant");
  if (body.get("client_id") !== grant.clientId) return oauthError("invalid_client", 401);
  if (body.get("redirect_uri") !== grant.redirectUri) return oauthError("invalid_grant");
  const verifier = String(body.get("code_verifier") ?? "");
  if ((await s256(verifier)) !== grant.challenge) return oauthError("invalid_grant");
  return Response.json({
    access_token: base64url(crypto.getRandomValues(new Uint8Array(32))),
    token_type: "Bearer",
    expires_in: TOKEN_TTL_S,
    id_token: await sign(grant.claims, grant.signing),
  });
}

/**
 * Answers a request for the fake Kenni whose issuer is `issuer`. Only the
 * path is read, so the Worker can reach it in process under any host.
 */
export async function fakeKenni(request: Request, issuer: string): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(url.pathname.indexOf(KENNI_PATH) + KENNI_PATH.length);
  switch (`${request.method} ${path}`) {
    case "GET /.well-known/openid-configuration":
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/oidc/auth`,
        token_endpoint: `${issuer}/oidc/token`,
        jwks_uri: `${issuer}/oidc/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "national_id", "audkenni_name"],
      });
    case "GET /oidc/jwks": {
      const { jwk } = await signingKeys();
      return Response.json({
        keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, kid: KID, alg: "RS256", use: "sig" }],
      });
    }
    case "GET /oidc/auth":
      return authorize(url, issuer);
    case "POST /oidc/token":
      return token(request);
    default:
      return new Response(null, { status: 404 });
  }
}

/** The binding the Worker's `kenni(env)` seam reaches the fake through. */
export function fakeKenniFetcher(issuer: string): Fetcher {
  return {
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fakeKenni(new Request(input, init), issuer),
    connect() {
      throw new Error("the fake Kenni has no sockets");
    },
  } as unknown as Fetcher;
}
