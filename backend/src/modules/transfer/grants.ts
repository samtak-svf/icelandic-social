import { db } from "../../env/index.ts";
import { base64url } from "../../shared/bytes.ts";
import { hashOf, type Scope, type TransferClient } from "./client.ts";

// The authorization server's state (decision 0129, RFC 6749 with RFC 9700's practice): a
// request waits for consent, consent makes a grant and a one-time code, and the code is
// redeemed for an hour's access token and a refresh token that rotates. Every value is
// kept only as its SHA-256. A code or a refresh token used twice is a stolen one, and the
// whole grant is revoked with it.

const REQUEST_MS = 10 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const ACCESS_S = 60 * 60;
const USED_REFRESH_MS = 24 * 60 * 60 * 1000;

const random = (prefix: string) =>
  `${prefix}${base64url(crypto.getRandomValues(new Uint8Array(32)))}`;
const newId = (prefix: string) => `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;

export type Request = {
  requestId: string;
  clientId: string;
  redirectUri: string;
  /** Whether the authorization request named redirect_uri itself (RFC 6749 4.1.3). */
  redirectNamed: boolean;
  scope: string;
  state: string | null;
  codeChallenge: string | null;
};

/** Keeps an authorization request for consent; its id is what the consent screen opens. */
export async function createRequest(
  env: Env,
  request: Omit<Request, "requestId">,
  now = Date.now(),
): Promise<string> {
  const requestId = newId("tr_");
  await db(env)
    .prepare(
      `INSERT INTO transfer_requests
         (request_id, client_id, redirect_uri, redirect_named, scope, state, code_challenge,
          expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      requestId,
      request.clientId,
      request.redirectUri,
      request.redirectNamed ? 1 : 0,
      request.scope,
      request.state,
      request.codeChallenge,
      now + REQUEST_MS,
    )
    .run();
  return requestId;
}

/** A request still waiting, or null. */
export async function requestOf(
  env: Env,
  requestId: string,
  now = Date.now(),
): Promise<Request | null> {
  const row = await db(env)
    .prepare(
      `SELECT request_id AS requestId, client_id AS clientId, redirect_uri AS redirectUri,
              redirect_named AS redirectNamed, scope, state, code_challenge AS codeChallenge
         FROM transfer_requests WHERE request_id = ? AND expires_at > ?`,
    )
    .bind(requestId, now)
    .first<Omit<Request, "redirectNamed"> & { redirectNamed: number }>();
  return row && { ...row, redirectNamed: row.redirectNamed === 1 };
}

/** Where the browser goes back to the exporter with `params`, the request's state added. */
function back(request: Request, params: Record<string, string>): string {
  const url = new URL(request.redirectUri);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (request.state !== null) url.searchParams.set("state", request.state);
  return url.href;
}

const dropRequest = (env: Env, requestId: string) =>
  db(env).prepare("DELETE FROM transfer_requests WHERE request_id = ?").bind(requestId);

/**
 * The person's consent: a grant and its one-time code; where the browser goes next, or
 * null when the request was already consumed by another approval or a refusal.
 */
export async function approve(
  env: Env,
  accountId: string,
  request: Request,
  now = Date.now(),
): Promise<string | null> {
  // Consuming the request comes first and is the only gate: of two approvals racing on one
  // request, one deletes its row and the other finds nothing to delete.
  const consumed = await dropRequest(env, request.requestId).run();
  if (consumed.meta.changes !== 1) return null;
  const grantId = newId("tg_");
  const code = random("dc_");
  await db(env).batch([
    db(env)
      .prepare(
        `INSERT INTO transfer_grants (grant_id, account_id, client_id, scope, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(grantId, accountId, request.clientId, request.scope, now),
    db(env)
      .prepare(
        `INSERT INTO transfer_tokens
           (token_hash, grant_id, kind, redirect_uri, redirect_named, code_challenge, expires_at)
         VALUES (?, ?, 'code', ?, ?, ?, ?)`,
      )
      .bind(
        await hashOf(code),
        grantId,
        request.redirectUri,
        request.redirectNamed ? 1 : 0,
        request.codeChallenge,
        now + CODE_MS,
      ),
  ]);
  return back(request, { code });
}

/** The person's refusal; where the browser goes next. */
export async function deny(env: Env, request: Request): Promise<string> {
  await dropRequest(env, request.requestId).run();
  return back(request, { error: "access_denied" });
}

export type Tokens = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};

type TokenRow = {
  grantId: string;
  kind: "code" | "access" | "refresh";
  redirectUri: string | null;
  redirectNamed: number;
  codeChallenge: string | null;
  expiresAt: number | null;
  usedAt: number | null;
  clientId: string;
  accountId: string;
  scope: string;
  revokedAt: number | null;
};

async function tokenRow(env: Env, value: string): Promise<TokenRow | null> {
  return db(env)
    .prepare(
      `SELECT t.grant_id AS grantId, t.kind, t.redirect_uri AS redirectUri,
              t.redirect_named AS redirectNamed, t.code_challenge AS codeChallenge, t.expires_at AS expiresAt, t.used_at AS usedAt,
              g.client_id AS clientId, g.account_id AS accountId, g.scope, g.revoked_at AS revokedAt
         FROM transfer_tokens t JOIN transfer_grants g ON g.grant_id = t.grant_id
        WHERE t.token_hash = ?`,
    )
    .bind(await hashOf(value))
    .first<TokenRow>();
}

const revokeStatement = (env: Env, grantId: string, now: number) =>
  db(env)
    .prepare("UPDATE transfer_grants SET revoked_at = ? WHERE grant_id = ? AND revoked_at IS NULL")
    .bind(now, grantId);

/** A new access and refresh token for the grant, the used one marked in the same batch. */
async function issue(env: Env, row: TokenRow, used: string, now: number): Promise<Tokens | null> {
  const access = random("da_");
  const renewal = random("dr_");
  const insert = db(env).prepare(
    `INSERT INTO transfer_tokens (token_hash, grant_id, kind, expires_at) VALUES (?, ?, ?, ?)`,
  );
  // Marking it used is conditional, so two redemptions racing issue tokens only once.
  const [marked] = await db(env).batch([
    db(env)
      .prepare("UPDATE transfer_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL")
      .bind(now, await hashOf(used)),
  ]);
  if (marked?.meta.changes !== 1) {
    await revokeStatement(env, row.grantId, now).run();
    return null;
  }
  await db(env).batch([
    insert.bind(await hashOf(access), row.grantId, "access", now + ACCESS_S * 1000),
    insert.bind(await hashOf(renewal), row.grantId, "refresh", null),
  ]);
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_S,
    refresh_token: renewal,
    scope: row.scope,
  };
}

/** Whether `verifier` answers the S256 `challenge` (RFC 7636 4.6). */
/**
 * Whether the verifier answers the code's challenge. A verifier with no challenge is a
 * downgrade, refused as a wrong one (RFC 9700 2.1.1); no challenge and no verifier passes.
 */
async function pkceMatches(
  challenge: string | null,
  verifier: string | undefined,
): Promise<boolean> {
  if (challenge === null) return verifier === undefined;
  if (verifier === undefined || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest)) === challenge;
}

/** The authorization_code grant; invalid_grant for anything a stranger could have sent. */
export async function redeemCode(
  env: Env,
  client: TransferClient,
  input: { code: string; redirectUri: string | undefined; verifier: string | undefined },
  now = Date.now(),
): Promise<Tokens | "invalid_grant"> {
  const row = await tokenRow(env, input.code);
  if (!row || row.kind !== "code" || row.clientId !== client.id) return "invalid_grant";
  if (row.usedAt !== null) {
    await revokeStatement(env, row.grantId, now).run();
    return "invalid_grant";
  }
  const spent = row.revokedAt !== null || (row.expiresAt ?? 0) <= now;
  // RFC 6749 4.1.3: required only when the authorization request carried it, and then exact.
  const redirectOk =
    input.redirectUri === undefined
      ? row.redirectNamed === 0
      : input.redirectUri === row.redirectUri;
  if (spent || !redirectOk) return "invalid_grant";
  if (!(await pkceMatches(row.codeChallenge, input.verifier))) return "invalid_grant";
  return (await issue(env, row, input.code, now)) ?? "invalid_grant";
}

/**
 * The refresh_token grant, rotating the token. A refresh token that is unknown, revoked
 * or used before is the exporter's sign that the person must connect again.
 */
export async function refresh(
  env: Env,
  client: TransferClient,
  token: string,
  now = Date.now(),
): Promise<Tokens | "session_invalidated"> {
  const row = await tokenRow(env, token);
  if (!row || row.kind !== "refresh" || row.clientId !== client.id) return "session_invalidated";
  if (row.revokedAt !== null) return "session_invalidated";
  if (row.usedAt !== null) {
    await revokeStatement(env, row.grantId, now).run();
    return "session_invalidated";
  }
  return (await issue(env, row, token, now)) ?? "session_invalidated";
}

/** Revokes the grant a token belongs to, whichever of its tokens it is (RFC 7009). */
export async function revokeByToken(
  env: Env,
  client: TransferClient,
  token: string,
  now = Date.now(),
): Promise<void> {
  const row = await tokenRow(env, token);
  if (row && row.clientId === client.id) await revokeStatement(env, row.grantId, now).run();
}

export type Bearer = { grantId: string; accountId: string; clientId: string; scopes: Scope[] };

/** Who an access token speaks for, or null when it is unknown, expired or revoked. */
export async function bearerOf(env: Env, token: string, now = Date.now()): Promise<Bearer | null> {
  const row = await tokenRow(env, token);
  if (!row || row.kind !== "access" || row.revokedAt !== null) return null;
  if ((row.expiresAt ?? 0) <= now) return null;
  return {
    grantId: row.grantId,
    accountId: row.accountId,
    clientId: row.clientId,
    scopes: row.scope.split(" ") as Scope[],
  };
}

/** The person's own revocation; false when the grant is not theirs or is already revoked. */
export async function revokeGrant(
  env: Env,
  accountId: string,
  grantId: string,
  now = Date.now(),
): Promise<boolean> {
  const done = await db(env)
    .prepare(
      `UPDATE transfer_grants SET revoked_at = ?
        WHERE grant_id = ? AND account_id = ? AND revoked_at IS NULL`,
    )
    .bind(now, grantId, accountId)
    .run();
  return done.meta.changes === 1;
}

/** Drops requests never answered, codes never redeemed and spent refresh tokens past their time; how many. */
export async function expireTransfers(env: Env, now = Date.now()): Promise<number> {
  const [requests, codes, refreshes] = await db(env).batch([
    db(env).prepare("DELETE FROM transfer_requests WHERE expires_at <= ?").bind(now),
    db(env)
      .prepare("DELETE FROM transfer_tokens WHERE kind IN ('code', 'access') AND expires_at <= ?")
      .bind(now - CODE_MS),
    // A used refresh token stays a day, so that a replay of it still revokes the grant.
    db(env)
      .prepare("DELETE FROM transfer_tokens WHERE kind = 'refresh' AND used_at <= ?")
      .bind(now - USED_REFRESH_MS),
  ]);
  return (
    (requests?.meta.changes ?? 0) + (codes?.meta.changes ?? 0) + (refreshes?.meta.changes ?? 0)
  );
}

export type GrantRow = { grantId: string; clientId: string; scope: string; createdAt: number };

/** The person's grants still in force, newest first. */
export async function grantsOf(env: Env, accountId: string): Promise<GrantRow[]> {
  const { results } = await db(env)
    .prepare(
      `SELECT grant_id AS grantId, client_id AS clientId, scope, created_at AS createdAt
         FROM transfer_grants WHERE account_id = ? AND revoked_at IS NULL
        ORDER BY created_at DESC, grant_id DESC LIMIT 50`,
    )
    .bind(accountId)
    .all<GrantRow>();
  return results;
}
