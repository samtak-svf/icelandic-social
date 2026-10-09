# 0019. Sign-in with Kenni, personal invites, and the end of a device or an account

- Status: accepted
- Date: 2026-10-06
- Decided by: Guðröður, approving the plan for sign-in and invites
- Builds on: [0008](0008-no-pii-in-logs.md), [0009](0009-v1-scope.md),
  [0014](0014-accounts-devices-and-auth.md), [0018](0018-the-client-engine-in-the-core.md)
- Amends: 0018, where the app told the core its ids after registering; the core now registers
- Amended by: [0028](0028-removing-a-device-from-its-groups.md) (a revoked device's leaves),
  [0033](0033-google-sign-in-and-kenni-verification.md) (Google signs in, Kenni verifies, identities, no invite needed)

## Decision

Decision 0014 says what an account and a device are. This one says how a person gets them, how
a person lets someone else in, and how both end.

### Kenni

- **The app runs the authorization and the Worker redeems the code.** The app opens Kenni's
  authorize URL in Custom Tabs or `ASWebAuthenticationSession`, with the redirect
  `is.samtak.spjall:/kenni` (the frozen `urlScheme`) and PKCE (S256). It sends the code and the
  verifier to `POST /v1/devices`. The Worker exchanges them at Kenni's token endpoint and checks
  the ID token itself: its RS256 signature against the issuer's JWKS, `iss`, `aud`, `exp` and the
  `nonce` the app sent. A client never vouches for who it is.
- **The client is a native one, so it is public.** Kenni gives native apps no secret, and none
  ships in an app. The Worker sends `KENNI_CLIENT_SECRET` on the exchange only if Kenni ever
  issues a confidential client.
- **Scopes `openid national_id audkenni_name`.** Both are released without a consent screen. The
  name shown is `audkenni_name`, the registry's name, and `verified` is set for every Kenni
  account. The verified mark of 0009 means the registry vouches for the name, which a name the
  person typed cannot. Kenni can leave the name empty for its test people, so the name may be
  null.
- **The issuer comes from configuration.** `KENNI_ISSUER` is a Worker var
  (`https://idp.kenni.is/innskraning.is` in production). The Worker reads its discovery document,
  and `GET /v1/sign-in` hands the app `{authorizationEndpoint, clientId, scope}`, so no app
  hardcodes the issuer.

### The person

- **The kennitala exists only as `HMAC-SHA256(KENNITALA_HMAC_KEY, national_id)`**, a Worker
  secret (0014, 0008). A sign-in whose HMAC matches an account is that person: the device joins
  the old account, and no invite is needed. Neither the kennitala nor the name is ever logged.

### Invites

- **An invite is a random 32-byte token, base64url, and D1 keeps only its SHA-256**, as it does
  for device tokens. A leaked database hands out no working invite.
- **Each account has one personal invite.** It can be used any number of times. Rotating it
  revokes the old one, and revoking it leaves the account with none. The link is
  `https://spjall.samtak.is/l/{token}` (`hosts.link`, `hosts.linkPathPrefix`). The app keeps its
  link in the core's store. A device that does not have it rotates the link, because the server
  cannot show it again.
- **`accounts.invited_by` records who let a person in.** A sign-in with no account and no valid
  invite gets `403`.
- **`GET /v1/invites/{token}` needs no device token.** The link is opened before sign-in, and the
  token is the capability: 256 bits that live only in the link. The answer is the inviter's name
  and verified mark, which is what the link page and the app show before sign-in, or `404`.
- **The first account is let in by the operator.** `pnpm invite:operator` writes one single-use
  invite with no inviter through `wrangler d1 execute` and prints its link once. Someone has to be
  first, and a secret built into the Worker would be a standing way in.
- **The admin list of 0014 waits** until something exists that only an admin may do. Today
  every account may mint invites.

### The link host

The Worker also serves the link host:

- `/l/{token}`: a small page with the inviter's name, an "open in the app" link
  (`is.samtak.spjall://invite/{token}`) and how to join the test group. It shows nothing that
  `GET /v1/invites` does not.
- `/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association`, generated from
  `identifiers/ids.json`. The signing-certificate fingerprints and the team id come from vars,
  empty until the store accounts exist. Until then the page's link to the app does the job of
  App Links and Universal Links.

### The core signs in

- **The core owns sign-in, as it owns sync (0018).**
  - `beginSignIn()` fetches `GET /v1/sign-in` itself, makes the PKCE verifier, the `state` and
    the `nonce`, keeps them in the store, and returns the authorize URL. A new one replaces any
    sign-in still pending.
  - `completeSignIn(callbackUrl, inviteToken, platform)` checks the callback is to the redirect
    and carries the pending `state`, then sends the code, the verifier, the nonce and the device
    key to `POST /v1/devices`, and stores the account id, the device id and the device token.
    It replaces `registered()`.
  - A callback with another `state` is refused and the sign-in stays pending, so a forged
    callback cannot end it. No answer from the server keeps it too, so the same call can be
    made again; any answer ends it, because Kenni's code is spent either way.
  - The core puts the token on each request as `bearer`, and the app's transport turns it into
    `Authorization`. The transport is called while the core holds its lock, so it cannot ask the
    core for the token itself. `deviceToken()` gives it for the WebSocket upgrade.
  - A sign-in survives the process being killed while the browser is open, because the pending
    state is in the store.
  - The account calls are the core's as well: `me`, the invite link (`rotateInvite`,
    `inviteLink`, `revokeInvite`, `resolveInvite`), `revokeDevice` and `deleteAccount`. Revoking
    this device, or deleting the account, empties the store, and so does revoking this device
    when its token is already dead.

### The end of a device, and of an account

- **Revoking a device** stamps `revoked_at`, so its token fails at once. It also deletes its
  KeyPackages and closes its socket through the `Inbox`. Its leaves are removed from its
  groups by a member's commit, as [0028](0028-removing-a-device-from-its-groups.md) says.
- **`DELETE /v1/me` keeps 0014's order:**
  1. every device token is revoked;
  2. each conversation the `Inbox` knows drops the account from its roster
     (`Conversation.removeAccount`);
  3. the `Inbox` deletes its storage;
  4. the account's media in R2 are deleted (there is no upload route yet, so this step has
     nothing to delete until media exist);
  5. the account's D1 rows are deleted, and with them its devices, KeyPackages and invites.

### Development

- **A fake Kenni (`backend/dev/kenni.ts`) is a real OIDC provider and is never deployed.** It
  serves discovery, authorize, token and JWKS. It signs with an RS256 key made when it starts,
  checks PKCE, and lets a test pick its person with `login_hint`. The test Worker and
  `dev/worker.ts` mount it, and `KENNI_ISSUER` points at it. The interop test registers through
  it as an app does, so `POST /dev/devices` goes away.
- Test people have kennitölur born in 2099, which belong to nobody. They are computed when a
  test runs and never written out, because `tooling/pii-guard.mjs` refuses any valid person's
  kennitala in a file, whatever its date.

## Why

The person's identity has to come from the registry through a path the server checks itself.
Anything a client sends could be made up. The invite is the only gate a closed test group
needs (0009). Keeping only hashes of invites and tokens means a copy of the database lets
nobody in. Putting PKCE, `state` and registration in the core keeps the subtle part in one
tested place, as 0018 did for sync.

## Rules out

- Trusting an ID token or a name that a client sends.
- A client secret in an app.
- An invite or device token stored in a form the server can read back.
- A kennitala, a name or a token in a log.
- A bootstrap secret in the Worker.
- A fake identity provider in any deployed configuration.
