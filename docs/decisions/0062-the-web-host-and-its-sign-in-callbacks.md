# 0062. The web is served on the API's host, and signs in through its own callbacks

- Status: accepted; designed, not yet implemented
- Date: 2026-10-17
- Decided by: Guðröður Atli Jónsson
- Builds on: [0027](0027-kenni-client-id-spjall.md) (the Kenni client),
  [0033](0033-google-sign-in-and-kenni-verification.md) (the Google web client),
  [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (one Worker),
  [0061](0061-account-identity-session-and-device-are-separate.md) (the session cookie and
  web sign-in)
- Amends: [0004](0004-frozen-identifiers-vs-brand.md) (`hosts.web`,
  `hosts.webSignInCallbacks` and `identity.kenniWebClientId` are frozen ids)

## Decision

### The host

- **`hosts.web` is `spjall.samtak.is`, the host `hosts.api` and `hosts.link` already
  name.** One origin serves the web app at `/`, the API at `/v1/` and the links at `/l/`.
  The session cookie (0061) is first-party to the API, with no CORS and no cookie shared
  between hosts.
- **No DNS change.** The custom domain exists and points at the Worker.
- The web's own routes are everything outside `/v1/`, `/l/`, `/auth/`, `/oauth/` and the
  well-known files, so a path the web adds never shadows one the apps rely on.

### The sign-in callbacks

| Provider | Callback on the web host | Client                                                      |
| -------- | ------------------------ | ----------------------------------------------------------- |
| Kenni    | `/auth/kenni/callback`   | `@innskraning.is/spjall-web`, a new confidential web client |
| Google   | `/auth/google/callback`  | The Google web client of 0033, with a second redirect URI   |

- **They are frozen in `identifiers/ids.json`** as `hosts.webSignInCallbacks`, since each is
  registered with a provider and a change means registering again.
- **Kenni gets a second client for the web.** The client of 0027 is a _Native_ application:
  public, with only the app's custom-scheme redirect. A server-side flow is redeemed by the
  Worker, which can keep a secret, so it uses a confidential _Web_ client, with its own
  secret. Both clients see the same person: an account is found by the kennitala's HMAC,
  never by the client (0014).
- **Google keeps one client.** The client of 0033 is already a confidential web client
  redeemed by the Worker. It gains the redirect `https://spjall.samtak.is/auth/google/callback`
  beside `/oauth/google`, which the apps keep. No JavaScript origin is needed: the browser
  never calls Google's endpoints from script.
- `GET /v1/sign-in` and `/oauth/google` are unchanged for the apps.

### Maintainer steps

These are the maintainer's, not an agent's (AGENTS.md):

1. On developers.kenni.is, under Samtak's team, create a _Web_ application with the client id
   `@innskraning.is/spjall-web`, the redirect `https://spjall.samtak.is/auth/kenni/callback`,
   the post-logout redirect `https://spjall.samtak.is/`, the scopes
   `openid national_id audkenni_name`, and the brand's name as its _Name_, as 0027 has it.
   Test user access off.
2. Put its secret in the vault as `samtak-spjall-kenni-web-client-secret`.
3. In the Google Cloud console, add `https://spjall.samtak.is/auth/google/callback` to the
   authorized redirect URIs of the existing web client. Nothing else on it changes.

The Worker reads the new secret as `KENNI_WEB_CLIENT_SECRET`, added to
`tooling/worker-secrets.mjs` in the PR that builds web sign-in. Until it is set, web sign-in
with Kenni answers `503`, as Google did before its secret (0033).

## Why

- One origin is what makes 0061's cookie simple: `__Host-`, `SameSite=Lax` and an exact
  `Origin` check, with no cross-site requests to allow. A separate web host would need CORS
  with credentials, a cookie on a parent domain, or a token held by script, each a weaker
  design.
- The same host already serves links and Google's redirect, so the web adds no DNS, no
  certificate and no second Worker.
- A confidential client for a server-side flow is what OAuth's security advice asks for
  where the client can keep a secret. Registering a separate Kenni client also leaves the
  apps' client, and every installed app, untouched.
- Paths under `/auth/` keep the web's callbacks apart from the apps' `/oauth/google` and from
  whatever routes the web app has.

## Rules out

- A separate web host or subdomain, and CORS with credentials.
- Registering the web redirect on the Kenni _Native_ client.
- A second Google client, or a Google sign-in started from script in the browser.
- A callback path outside `ids.json`.
