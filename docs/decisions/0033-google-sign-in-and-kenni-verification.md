# 0033. Google signs a person in; Kenni verifies who they are

- Status: accepted; designed, not yet implemented
- Date: 2026-10-09
- Decided by: the maintainer, approving the plan for Google sign-in, Kenni verification and
  the feed
- Builds on: [0008](0008-no-pii-in-logs.md), [0014](0014-accounts-devices-and-auth.md),
  [0018](0018-the-client-engine-in-the-core.md), [0019](0019-sign-in-and-invites.md)
- Amends: 0009 (the invite as the beta gate, the name shown), 0014 (an account is created by
  a Kenni sign-in), 0019 (Kenni as the only way in, `verified` set for every account, the
  invite required for a new account)

## Decision

Until now an account came only from a Kenni sign-in with an invite, and its key was the
kennitala HMAC. From here a person signs in with Google first. Kenni becomes an optional step
that verifies the name. The invite stays as a way to reach someone, not as a gate.

### Identities

- **An account holds identities, at most one per provider.** A D1 table
  `identities(provider, subject_hmac, account_id)` with `UNIQUE(provider, subject_hmac)`
  replaces `accounts.kennitala_hmac`. Providers are `google` and `kenni`.
- **A subject exists only as an HMAC under `KENNITALA_HMAC_KEY`**, the key 0019 already uses.
  A Kenni subject is the `national_id` as before, so existing rows are copied over unchanged.
  A Google subject is `google:` followed by its `sub`. The key-rotation path is written once
  for every provider, and no new secret is needed.
- **A sign-in whose HMAC matches an identity is that account**, whichever provider made it.
  A sign-in that matches none creates an account, with either provider.
- **`accounts.kennitala_hmac` is read until the copy has run in production**, then dropped by a
  later migration.

### Google

- **The same browser and PKCE flow as Kenni (0019)**, through one Google web client. The app
  opens Google's authorize URL in Custom Tabs or `ASWebAuthenticationSession`. The redirect is
  `https://<hosts.link>/oauth/google`, a page on the link host that passes `code` and `state` on
  to `is.samtak.spjall:/google`. The core sends the code and verifier to `POST /v1/devices`.
  The Worker redeems them with `GOOGLE_CLIENT_SECRET` and checks the ID token as it checks
  Kenni's: signature against the issuer's JWKS, `iss`, `aud`, `exp` and the `nonce`.
  - No Google SDK ships in either app, and no new URL scheme or frozen id is needed. The
    client secret never leaves the Worker.
  - Google refuses custom schemes for web clients, which is why the link host relays the code.
    PKCE makes a relayed code useless without the verifier that only the core holds.
- **Scopes `openid email profile`, none of them sensitive.** The ID token must carry
  `email_verified: true`, otherwise `403 sign_in_failed`. That is the email check the plan
  asked for: Google has already sent the mail. **The email address is never stored or
  logged.** The name shown is the token's `name`, with `verified = 0`.
- **The client id is a Worker var (`GOOGLE_CLIENT_ID`), not a frozen id.** `GET /v1/sign-in`
  already hands the app the client id, so it can change without a release. Without the var or
  the secret, Google sign-in answers `503 google_unavailable` and Kenni still works.
- **During the build stage the Google client stays in Testing mode**, so only the Google
  accounts listed on its consent screen can sign in.

### Kenni

- **Kenni verifies a name.** Linking a Kenni identity to an account sets `verified = 1` and
  sets `display_name` to the registry's `audkenni_name`, when Kenni gives one. The mark keeps
  the meaning 0019 gave it: the registry vouches for the name. A Google account without a
  Kenni identity has no mark.
- **Signing in with Kenni stays**, as a secondary choice on the sign-in screen. Every account
  made before this record is a Kenni account, and it must stay reachable on a new device.
- **Linking is `POST /v1/me/identities`** with a provider and a code, made through the same
  browser flow. An identity already held by another account gets `409 identity_taken`. The
  route takes either provider, so a Kenni account can add Google the same way.

### Invites

- **A new account no longer needs an invite.** The gate during the build stage is
  distribution (TestFlight and Play internal testing) and Google's Testing mode. Someone who
  builds their own client could still create an account with Kenni. That is accepted for a
  build-stage test. The gate for a public release in 0009 is unchanged.
- **The personal invite stays**, as a link and QR code that open a 1:1 with its owner (0022).
  `accounts.invited_by` is still recorded when a link was used.

### The contract

`RegisterDevice` gains `provider` and `code`. `kenniCode` is still accepted, marked
deprecated, and removed after the next floor raise (0030). `GET /v1/sign-in` takes
`?provider=`, with `kenni` the default. So clients at the current floor are unaffected and
`oasdiff` sees no breaking change.

## Why

A Google account is something nearly every tester already has, and it needs no Icelandic eID.
The verified mark is worth more when it is earned than when everyone has it. One identities
table lets one person hold both identities without a second account model, and keeps the HMAC
discipline of 0008 and 0019 for every provider.

## Rules out

- Storing or logging an email address, a Google `sub` or a kennitala in clear.
- A Google SDK or a client secret in an app.
- The mark on a name the registry did not vouch for.
- Merging two existing accounts, or removing an account's last identity.
- A frozen id for the Google client.
