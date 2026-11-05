import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { expireTransfers } from "../../../src/modules/transfer/index.ts";
import { approve, requestOf, type Request } from "../../../src/modules/transfer/grants.ts";
import { ok, person } from "../../people.ts";
import {
  as,
  authorize,
  basic,
  call,
  challengeOf,
  CLIENT_ID,
  CLIENT_SECRET,
  connect,
  consent,
  REDIRECT,
  token,
  transferEnv,
} from "./flow.ts";

// The authorization server an exporter talks to (decision 0129). The bug each test names:
// a code reaching a redirect nobody registered, a code or refresh token working twice, PKCE
// passing with the wrong verifier, a wrong secret getting tokens, a revoked grant still
// working, a token stored as itself, or any of it answering while no exporter is registered.

type Grants = { available: boolean; grants: { grantId: string; clientName: string }[] };

describe("direct transfer authorization", () => {
  it("runs authorize, token, refresh and revoke for the person who consented", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const requestId = await authorize(E);
    expect(await ok(await as(E, anna, "GET", `/v1/transfer-requests/${requestId}`))).toEqual({
      clientName: "Exporter",
      scopes: ["social-posts", "media"],
    });

    const first = await connect(E, anna);
    expect(first).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "social-posts media",
    });
    // Only hashes are kept.
    const kept = await env.DB.prepare("SELECT token_hash AS hash FROM transfer_tokens").all<{
      hash: string;
    }>();
    expect(kept.results.map((r) => r.hash)).not.toContain(first.access_token);
    expect(kept.results.every((r) => /^[0-9a-f]{64}$/.test(r.hash))).toBe(true);

    const refreshed = await token(E, {
      grant_type: "refresh_token",
      refresh_token: first.refresh_token,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.headers.get("cache-control")).toBe("no-store");
    const second = (await refreshed.json()) as typeof first;
    expect(second.refresh_token).not.toBe(first.refresh_token);

    const listed = await ok<Grants>(await as(E, anna, "GET", "/v1/transfers"));
    expect(listed.available).toBe(true);
    expect(listed.grants.map((g) => g.clientName)).toEqual(["Exporter"]);

    const revoked = await call(E, "/oauth/revoke", {
      method: "POST",
      headers: { authorization: basic(), "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: second.refresh_token }).toString(),
    });
    expect(revoked.status).toBe(200);
    const after = await token(E, {
      grant_type: "refresh_token",
      refresh_token: second.refresh_token,
    });
    expect(after.status).toBe(401);
    expect(await after.json()).toMatchObject({ error: "session_invalidated" });
    expect((await ok<Grants>(await as(E, anna, "GET", "/v1/transfers"))).grants).toEqual([]);
  });

  it("reads a form body for credentials and holds it to its size", async () => {
    const E = await transferEnv();
    const revoke = (form: Record<string, string>) =>
      call(E, "/oauth/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      });
    // The credentials travel in the body (RFC 6749 2.3.1), with a non-ASCII token value.
    expect(
      (await revoke({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, token: "þjóð" })).status,
    ).toBe(200);
    expect((await revoke({ client_id: CLIENT_ID, client_secret: "wrong" })).status).toBe(401);
    // Over 16 KiB of bytes is refused, even when the characters alone would fit.
    const big = await revoke({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      token: "þ".repeat(9_000),
    });
    expect(big.status).toBe(400);
    expect(await big.json()).toMatchObject({ error: "invalid_request" });
  });

  it("lets the person revoke a grant, and only their own", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const bjorn = await person("Bjorn");
    const tokens = await connect(E, anna);
    const [grant] = (await ok<Grants>(await as(E, anna, "GET", "/v1/transfers"))).grants;
    expect((await as(E, bjorn, "DELETE", `/v1/transfers/${grant?.grantId}`)).status).toBe(404);
    expect((await as(E, anna, "DELETE", `/v1/transfers/${grant?.grantId}`)).status).toBe(204);
    const after = await token(E, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(after.status).toBe(401);
  });

  it("never redirects to an unregistered address or for an unknown client", async () => {
    const E = await transferEnv();
    for (const query of [
      { redirect_uri: "https://elsewhere.example/callback" },
      { client_id: "someone-else" },
    ]) {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT,
        ...query,
      });
      const response = await call(E, `/oauth/authorize?${params}`);
      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
    const params = new URLSearchParams({
      response_type: "code",
      client_id: CLIENT_ID,
      scope: "calendar",
    });
    const bad = await call(E, `/oauth/authorize?${params}`);
    expect(bad.status).toBe(302);
    expect(new URL(bad.headers.get("location") ?? "").searchParams.get("error")).toBe(
      "invalid_scope",
    );
  });

  it("refuses a code at another redirect, and a reused code ends the grant", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const code = await consent(E, anna);
    const elsewhere = await token(E, {
      grant_type: "authorization_code",
      code,
      redirect_uri: `${REDIRECT}/x`,
    });
    expect(await elsewhere.json()).toMatchObject({ error: "invalid_grant" });

    const again = await consent(E, anna);
    const used = await token(E, {
      grant_type: "authorization_code",
      code: again,
      redirect_uri: REDIRECT,
    });
    const tokens = (await used.json()) as { refresh_token: string };
    const reused = await token(E, {
      grant_type: "authorization_code",
      code: again,
      redirect_uri: REDIRECT,
    });
    expect(reused.status).toBe(400);
    expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
    // A replayed code is a stolen one: what it issued stops working.
    const refreshed = await token(E, {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
    expect(refreshed.status).toBe(401);
  });

  it("holds PKCE to the verifier, and refuses a verifier with no challenge", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const verifier = "v".repeat(43);
    const code = await consent(E, anna, {
      code_challenge: await challengeOf(verifier),
      code_challenge_method: "S256",
    });
    const wrong = await token(E, {
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT,
      code_verifier: "w".repeat(43),
    });
    expect(await wrong.json()).toMatchObject({ error: "invalid_grant" });

    const right = await consent(E, anna, {
      code_challenge: await challengeOf(verifier),
      code_challenge_method: "S256",
    });
    expect(
      (
        await token(E, {
          grant_type: "authorization_code",
          code: right,
          redirect_uri: REDIRECT,
          code_verifier: verifier,
        })
      ).status,
    ).toBe(200);

    const plain = await consent(E, anna);
    const downgrade = await token(E, {
      grant_type: "authorization_code",
      code: plain,
      redirect_uri: REDIRECT,
      code_verifier: verifier,
    });
    expect(await downgrade.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("refuses a wrong client secret, by header or by form", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const code = await consent(E, anna);
    const header = await token(
      E,
      { grant_type: "authorization_code", code, redirect_uri: REDIRECT },
      basic(CLIENT_ID, "wrong"),
    );
    expect(header.status).toBe(401);
    expect(await header.json()).toMatchObject({ error: "invalid_client" });
    expect(header.headers.get("www-authenticate")).toContain("Basic");
    const form = await token(
      E,
      {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT,
        client_id: CLIENT_ID,
        client_secret: "wrong",
      },
      "",
    );
    expect(form.status).toBe(401);
  });

  it("lets the person deny, and the exporter hears access_denied", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const requestId = await authorize(E);
    const { redirect } = await ok<{ redirect: string }>(
      await as(E, anna, "POST", `/v1/transfer-requests/${requestId}/deny`),
    );
    expect(new URL(redirect).searchParams.get("error")).toBe("access_denied");
    expect((await as(E, anna, "POST", `/v1/transfer-requests/${requestId}/approve`)).status).toBe(
      404,
    );
  });

  it("expires waiting requests and spent codes", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    await authorize(E);
    await consent(E, anna);
    expect(await expireTransfers(E, Date.now() + 60 * 60 * 1000)).toBeGreaterThan(0);
  });

  it("lets one request be approved once, however many approvals race", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const requestId = await authorize(E);
    // Both have read the request before either consumes it, as two parallel calls would.
    const request = await requestOf(E, requestId);
    expect(request).not.toBeNull();
    const answers = await Promise.all([
      approve(E, anna.accountId, request as Request),
      approve(E, anna.accountId, request as Request),
    ]);
    expect(answers.filter((a) => a !== null)).toHaveLength(1);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM transfer_grants WHERE account_id = ?",
    )
      .bind(anna.accountId)
      .first<{ n: number }>();
    expect(row?.n).toBe(1);
    // And through the route, a request already consumed answers not found.
    const again = await as(E, anna, "POST", `/v1/transfer-requests/${requestId}/approve`);
    expect(again.status).toBe(404);
  });

  it("accepts a token request without redirect_uri only when the authorization had none", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const bare = await consent(E, anna, { redirect_uri: "" });
    expect((await token(E, { grant_type: "authorization_code", code: bare })).status).toBe(200);
    // A redirect_uri that is present must still match.
    const wrong = await consent(E, anna, { redirect_uri: "" });
    expect(
      (
        await token(E, {
          grant_type: "authorization_code",
          code: wrong,
          redirect_uri: "https://exporter.example/other",
        })
      ).status,
    ).toBe(400);
    // A request that named it makes the token request name it.
    const named = await consent(E, anna);
    expect((await token(E, { grant_type: "authorization_code", code: named })).status).toBe(400);
  });

  it("drops a used refresh token after a day, and keeps a recent one to catch a replay", async () => {
    const E = await transferEnv();
    const anna = await person("Anna");
    const first = await connect(E, anna);
    await token(E, { grant_type: "refresh_token", refresh_token: first.refresh_token });
    const used = () =>
      env.DB.prepare(
        `SELECT COUNT(*) AS n FROM transfer_tokens
          WHERE kind = 'refresh' AND used_at IS NOT NULL
            AND grant_id IN (SELECT grant_id FROM transfer_grants WHERE account_id = ?)`,
      )
        .bind(anna.accountId)
        .first<{ n: number }>()
        .then((r) => r?.n);
    await expireTransfers(E, Date.now() + 60 * 60 * 1000);
    expect(await used()).toBe(1);
    await expireTransfers(E, Date.now() + 25 * 60 * 60 * 1000);
    expect(await used()).toBe(0);
  });

  it("answers 404 everywhere while no exporter is registered", async () => {
    const E = await transferEnv(false);
    const anna = await person("Anna");
    expect(
      (await call(E, `/oauth/authorize?response_type=code&client_id=${CLIENT_ID}`)).status,
    ).toBe(404);
    expect((await token(E, { grant_type: "refresh_token", refresh_token: "x" })).status).toBe(404);
    expect((await call(E, "/oauth/revoke", { method: "POST" })).status).toBe(404);
    expect((await call(E, "/dtp/social-posts", { method: "POST" })).status).toBe(404);
    expect((await as(E, anna, "GET", "/v1/transfer-requests/tr_00")).status).toBe(404);
    expect((await ok<Grants>(await as(E, anna, "GET", "/v1/transfers"))).available).toBe(false);
  });
});
