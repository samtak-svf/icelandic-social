import { type Context, Hono } from "hono";
import type { AppEnv } from "../../http.ts";
import { protocolFail } from "../../shared/errors.ts";
import { log } from "../../shared/log.ts";
import { overAddressLimit } from "../../shared/rate-limit.ts";
import { clientOf, scopesOf, secretMatches, type TransferClient } from "./client.ts";
import { createRequest, redeemCode, refresh, revokeByToken } from "./grants.ts";

// The authorization server an exporter talks to (decision 0129): RFC 6749's code flow
// with S256 PKCE when the exporter sends it, RFC 7009's revocation, and RFC 9700's
// practice of exact redirect addresses and one-time codes. It is outside the API and its
// contract because the exporter's protocol fixes its shape. Without a configured
// exporter every path answers not found.

/** The largest form body a token or revocation request may have. */
const FORM_BYTES = 16 * 1024;
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

const oauthError = protocolFail;

const notFound = (c: Context<AppEnv>) => oauthError(c, 404, "not_found");

/** The form body, or null when it is too large or not a form. */
async function formOf(c: Context<AppEnv>): Promise<URLSearchParams | null> {
  const type = c.req.header("content-type") ?? "";
  if (!type.startsWith("application/x-www-form-urlencoded")) return null;
  const length = Number(c.req.header("content-length") ?? 0);
  if (length > FORM_BYTES) return null;
  const text = await c.req.text();
  return text.length > FORM_BYTES ? null : new URLSearchParams(text);
}

/** Whether the request authenticates as the client, by Basic header or form body (2.3.1). */
async function authenticated(
  c: Context<AppEnv>,
  client: TransferClient,
  form: URLSearchParams,
): Promise<boolean> {
  const basic = /^Basic ([A-Za-z0-9+/=]+)$/.exec(c.req.header("authorization") ?? "")?.[1];
  let id = form.get("client_id");
  let secret = form.get("client_secret");
  if (basic) {
    try {
      const [rawId, ...rest] = atob(basic).split(":");
      id = decodeURIComponent(rawId ?? "");
      secret = decodeURIComponent(rest.join(":"));
    } catch {
      return false;
    }
  }
  if (id !== client.id || !secret) return false;
  return secretMatches(client, secret);
}

function authorize(c: Context<AppEnv>, client: TransferClient) {
  const query = c.req.query();
  // A wrong client or redirect address is never redirected to (RFC 6749 4.1.2.1).
  if (query.client_id !== client.id) return oauthError(c, 400, "invalid_request", "unknown client");
  const only = client.redirectUris.length === 1 ? client.redirectUris[0] : undefined;
  const redirectUri = query.redirect_uri ?? only;
  if (!redirectUri || !client.redirectUris.includes(redirectUri))
    return oauthError(c, 400, "invalid_request", "unregistered redirect_uri");
  const refuse = (error: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (query.state !== undefined) url.searchParams.set("state", query.state);
    c.header("cache-control", "no-store");
    return c.redirect(url.href, 302);
  };
  if (query.response_type !== "code") return refuse("unsupported_response_type");
  const scopes = scopesOf(query.scope);
  if (!scopes || scopes.length === 0) return refuse("invalid_scope");
  const challenge = query.code_challenge;
  if (
    challenge !== undefined &&
    (query.code_challenge_method !== "S256" || !CHALLENGE.test(challenge))
  )
    return refuse("invalid_request");
  return { redirectUri, scope: scopes.join(" "), state: query.state ?? null, challenge };
}

export function oauthRoutes() {
  const app = new Hono<AppEnv>();

  app.get("/oauth/authorize", async (c) => {
    const client = clientOf(c.env);
    if (!client) return notFound(c);
    if (await overAddressLimit(c)) return oauthError(c, 429, "temporarily_unavailable");
    const checked = authorize(c, client);
    if (checked instanceof Response) return checked;
    const requestId = await createRequest(c.env, {
      clientId: client.id,
      redirectUri: checked.redirectUri,
      scope: checked.scope,
      state: checked.state,
      codeChallenge: checked.challenge ?? null,
    });
    c.header("cache-control", "no-store");
    return c.redirect(`/transfer/${requestId}`, 302);
  });

  app.post("/oauth/token", async (c) => {
    const client = clientOf(c.env);
    if (!client) return notFound(c);
    if (await overAddressLimit(c)) return oauthError(c, 429, "temporarily_unavailable");
    const form = await formOf(c);
    if (!form) return oauthError(c, 400, "invalid_request");
    if (!(await authenticated(c, client, form))) {
      c.header("www-authenticate", 'Basic realm="transfer"');
      return oauthError(c, 401, "invalid_client");
    }
    const grant = form.get("grant_type");
    let answer;
    if (grant === "authorization_code") {
      const code = form.get("code");
      if (!code) return oauthError(c, 400, "invalid_request");
      answer = await redeemCode(c.env, client, {
        code,
        redirectUri: form.get("redirect_uri") ?? undefined,
        verifier: form.get("code_verifier") ?? undefined,
      });
      if (answer === "invalid_grant") return oauthError(c, 400, "invalid_grant");
    } else if (grant === "refresh_token") {
      const token = form.get("refresh_token");
      if (!token) return oauthError(c, 400, "invalid_request");
      answer = await refresh(c.env, client, token);
      // What the exporter reads as the person's having taken the grant back.
      if (answer === "session_invalidated") return oauthError(c, 401, "session_invalidated");
    } else {
      return oauthError(c, 400, "unsupported_grant_type");
    }
    log("transfers.token", { code: grant });
    c.header("cache-control", "no-store");
    c.header("pragma", "no-cache");
    return c.json(answer, 200);
  });

  app.post("/oauth/revoke", async (c) => {
    const client = clientOf(c.env);
    if (!client) return notFound(c);
    const form = await formOf(c);
    if (!form) return oauthError(c, 400, "invalid_request");
    if (!(await authenticated(c, client, form))) return oauthError(c, 401, "invalid_client");
    const token = form.get("token");
    if (token) await revokeByToken(c.env, client, token);
    // Answered the same whether the token was known (RFC 7009 2.2).
    return c.body(null, 200);
  });

  return app;
}
