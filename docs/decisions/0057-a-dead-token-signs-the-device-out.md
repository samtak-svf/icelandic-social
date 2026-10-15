# 0057. A dead token signs the device out

- Status: accepted; designed, not yet implemented
- Date: 2026-10-15
- Decided by: the maintainer, choosing how testers land after the beta database is wiped
- Amends: [0019](0019-sign-in-and-invites.md) (signing out), [0022](0022-the-conversation-surfaces.md)
  (the socket)

## Decision

- **A 401 from the server is a dead token.** The device was revoked, or its account deleted,
  on this device or elsewhere, so no later call with that token can succeed.
- **The core signs the device out when `sync` or `on_frame` meets one.**
  - It empties the store, as revoking this device already does (0019), and the call returns
    `NotRegistered`.
  - The steps of a sync that otherwise wait for the next sync (KeyPackages, blocks, mutes,
    the push token) let a 401 through, so a device in no conversation finds out too.
- **The apps treat it as signing out.**
  - `NotRegistered` from a call the socket makes, or no device token when the socket starts,
    takes the app to the sign-in screen, the same way signing out in Ég does.
  - The socket reports a refused upgrade (HTTP 401) or a close with 4401 as unauthorized. The
    app then syncs once, so the core finds the dead token and signs out, instead of
    reconnecting forever.

## Why

Deleting an account or revoking a device on the server closed the device's socket and
failed every request, but the app kept its old store. It showed "connecting" forever and
conversations that no longer existed, and the only way out was to delete the app. Wiping the
beta database before the next test round would leave every tester there.

## What it rules out

- An app that keeps a store whose token the server refuses.
- A 401 handled in each screen: the core decides once, the apps follow one signal.
- Signing out on any other status: a 403 or 404 concerns one request, not the device.
