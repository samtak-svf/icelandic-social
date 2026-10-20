# 0061. Account, login identity, session and messaging device are four things

- Status: accepted; implemented in the backend (#321: sessions and the scheme each route
  declares, #322: web sign-in, #323: listing and ending sessions, #324: `web` in the version
  floor, as a client in `CLIENTS` beside the device platforms) and the web (#305, #328)
- Date: 2026-10-17
- Decided by: Guðröður Atli Jónsson
- Builds on: [0002](0002-mls-end-to-end-encryption.md) (a device is an MLS member),
  [0005](0005-contract-zod-openapi-generated-clients.md) (the contract),
  [0008](0008-no-pii-in-logs.md), [0028](0028-removing-a-device-from-its-groups.md),
  [0033](0033-google-sign-in-and-kenni-verification.md) (login identities),
  [0057](0057-a-dead-token-signs-the-device-out.md) (a dead token signs the device out),
  [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (the web is a client)
- Amends: 0014 (there is now an account-level session; a sign-in no longer has to create a
  device)

## Decision

### The four things

| Thing              | What it is                                                            | Ends when                                    |
| ------------------ | --------------------------------------------------------------------- | -------------------------------------------- |
| **Account**        | One person, with an opaque `accountId` (0014)                         | `DELETE /v1/me`                              |
| **Login identity** | A Google or Kenni subject that signs in to the account (0033)         | Unlinked, or the account is deleted          |
| **Session**        | One sign-in on one client: a browser, or an app on a phone            | Signed out, revoked, expired, or the account |
| **Device**         | An MLS member with its own Ed25519 key, KeyPackages and leaves (0002) | Revoked (0014, 0028), or its session ends    |

- **Every sign-in creates a session**, in the apps too. A session never creates a device on
  its own: a device is enrolled from a session, by a client that holds a key.
- **The apps enrol their device at sign-in, as today.** `POST /v1/devices` creates the
  session and the device together and answers with a `sessionId` beside `deviceId` and the
  device token. On a phone the two are one sign-in: ending either ends the other.
- **A browser gets a session and no device.** Signing in on the web never makes a KeyPackage,
  a leaf or an MLS credential, so reading a community never adds a browser to anyone's
  encrypted groups. A browser joins MLS only as a linked device, under its own record (#271).

### The session

- **D1 holds `sessions`**, owned by `identity/`: an opaque `sessionId`, the account, the
  client kind (`web`, `android`, `ios`), a coarse label shown to the person ("Firefox á
  Linux"), `created_at`, `last_seen_at` and `expires_at`. The secret that proves a session is
  stored only as a hash, as device tokens are (0014). A row never holds an IP address or a
  full user-agent string, and a log line carries the `sessionId` only (0008).
- **A browser carries the secret in one cookie**: `__Host-session`, `HttpOnly`, `Secure`,
  `SameSite=Lax`, `Path=/`, no `Domain`. Script on the page cannot read it, and no other host
  receives it. The web never holds a device token or a session secret in storage a script can
  read.
- **A browser session lasts 30 days from its last use**, renewed at most once a day, and
  never beyond 400 days from sign-in (the longest a browser keeps a cookie). A phone's session
  lasts as long as its device, as 0014 has it.
- **Every state-changing request with the cookie is checked for its `Origin`.** A `POST`,
  `PUT`, `PATCH` or `DELETE` that carries the session cookie is refused with `403` unless
  `Origin` is the web host exactly (#269); a missing `Origin` is refused too. `SameSite=Lax`
  is the second line, not the only one. A bearer request carries no cookie and is not
  affected.
- **Web sign-in is handled by the Worker.** It starts the authorization request with PKCE,
  `state` and `nonce`, keeps them in a short-lived `__Host-` cookie bound to that request,
  redeems the code at the callback on the web host, applies the same account rules as the
  apps (0033, 0035), creates the session and sets the cookie. The browser never sees a code
  verifier or an ID token.

### Which routes take which

- **The contract declares it.** OpenAPI security schemes name `session` (the cookie) and
  `device` (the bearer token, 0014), and every route lists the ones it accepts: messaging and
  KeyPackage routes and the socket take `device`; account, profile and block routes take
  either; web-only and social routes take `session`. One middleware reads the route's
  declaration, so a route without one fails the build, and `api/openapi.json` shows it.
- **A device token also yields its session**, so a handler that needs only the account reads
  the same value whichever way the caller came in.

### Ending things

They are three actions, each on its own route, and none implies a broader one:

- **Sign out, or revoke a session** (`DELETE /v1/sessions/{sessionId}`, from that session or
  another of the same account): that client is signed out. A device that the session
  enrolled is revoked with it (0014, 0028), so no device outlives the sign-in that made it.
- **Revoke a device** (`DELETE /v1/devices/{deviceId}`, as 0014): it leaves its groups. A
  browser's session stays signed in to the social side; a phone's session ends with it.
- **Delete the account** (`DELETE /v1/me`): every session and every device token first, then
  the rest in 0014's order.
- `GET /v1/me/sessions` lists every session of the account with its label and times, so a
  person can see and end each one.

### The transition

- **The device token of 0014 keeps working.** A migration gives every active device a
  session, so no app build at the current floor (0030) changes what it sends.
- `web` joins the platform list (`backend/src/platforms.ts`) with the first web build. It
  joined as a client of the version floor (`CLIENTS`), not as a device platform, so the D1
  CHECK on `devices.platform` still names only the apps (#324).

## Why

- 0014 made a device the only credential. That is right for a phone and wrong for a browser:
  a session per sign-in would otherwise have to be a device, and every web visit would add an
  MLS member that holds no key safely, to every group the person is in.
- One session model for every client avoids two ways of authenticating that would need
  joining later, and gives one list of where a person is signed in.
- A cookie the page cannot read, scoped to one host, with an explicit `Origin` check, is the
  smallest web credential that resists both script injection and cross-site requests. A
  token held in browser storage resists neither.
- Declaring the scheme per route in the contract makes the rule checkable by the contract's
  drift check (0005), not by memory.

## Rules out

- MLS enrolment as a side effect of signing in on the web.
- A session secret or device token in `localStorage`, `sessionStorage`, IndexedDB or a URL.
- A self-contained signed token (JWT) as a session, or a refresh token. A session is checked
  against D1 so that revoking it takes effect at once.
- `SameSite=None`, a `Domain` on the cookie, or a session readable by another host.
- A route that accepts a credential its declaration does not name.
- An IP address or a full user-agent string stored with a session.
