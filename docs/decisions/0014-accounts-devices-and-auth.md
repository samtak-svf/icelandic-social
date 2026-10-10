# 0014. An account has devices; each device holds its own revocable token

- Status: accepted; implemented. How a person signs in, how invites work and how a device or
  an account ends are in [0019](0019-sign-in-and-invites.md), which also defers the admin
  list. Welcomes travel with their commit through the `Conversation` DO
  ([0017](0017-conversations-on-the-server.md)); the `Inbox` holds the device list, the
  sockets and the delivery cursors.
- Date: 2026-10-06
- Decided by: Guðröður, approving the plan that acted on the phase-0 review
- Amended by: [0028](0028-removing-a-device-from-its-groups.md) (who removes a deleted account's leaves),
  [0033](0033-google-sign-in-and-kenni-verification.md) (an account is created by Google or Kenni, without an invite),
  [0035](0035-google-only-sign-in-and-merge-on-kenni.md) (a device moves with its token when linking Kenni joins two accounts)

## Decision

- **An account is one person, created by a Kenni sign-in** (OIDC, client id `kenniClientId` in
  `identifiers/ids.json`) together with an invite token (decision 0009). It has an opaque
  `accountId`. D1 keeps the account's display name and verified mark from Kenni, and the
  kennitala only as an HMAC under a Worker secret, enough to recognise a returning person and
  never readable back (decision 0008).
- **A device registers itself.** `POST /v1/devices` exchanges a Kenni authorization code
  (with PKCE) for a device: the device sends its Ed25519 public key, which is also its MLS
  credential key (decision 0002), and its platform. The server answers with `accountId`,
  `deviceId` and an opaque **device token**. The token is stored hashed in D1 and is shown
  once.
- **Every other route and the WebSocket upgrade carry
  `Authorization: Bearer <device token>`.** There is no account-level session and no refresh
  token. A token lives until its
  device is revoked (`DELETE /v1/devices/{deviceId}`, from that device or another device of
  the same account) or the account is deleted. (Amended by 0035: a device moved to the account
  Kenni joins it to keeps its token.)
- **One `Inbox` Durable Object per account** (`inbox(env, accountId)` in `backend/src/env/`).
  It holds the device list and routes Welcome messages to each device. Each device has its
  own socket (hibernating) and its own delivery cursor (decision 0015).
- **D1 owns accounts, devices, tokens, invites and the admin list.** Its migrations live in
  `backend/migrations/` (`wrangler.jsonc` `migrations_dir`), starting with the phase-1 PR
  that builds these routes.
- **`DELETE /v1/me` deletes the account**, in this order:
  1. every device token, so nothing can act for the account while the rest is deleted;
  2. the `Inbox` DO's storage (`deleteAll`);
  3. the media objects in R2 that the account uploaded, found by their D1 rows
     ([0023](0023-media-as-encrypted-blobs.md));
  4. the account's D1 rows, including the kennitala HMAC and its invites.

  What the server cannot delete: messages already delivered to other people's devices, and
  the account's membership in other people's MLS groups. Those groups' remaining devices
  issue the removal commits when they next see the account is gone, as
  [0028](0028-removing-a-device-from-its-groups.md) says. The dialog in the app
  says both (decision 0009).

## Why

A per-device credential is what lets one lost phone be cut off without signing the person
out everywhere, and it is the same unit MLS already uses. An opaque token checked against
D1 can be revoked at once, which a self-contained signed token cannot. One inbox per account
matches how few devices a person has and keeps Welcome routing in one place.

## Rules out

Phone-number accounts; passwords; a kennitala stored in clear or in a log; long-lived
account tokens shared by devices; a server that adds a device to a group on its own.
