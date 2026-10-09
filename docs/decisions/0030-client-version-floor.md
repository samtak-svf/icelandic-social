# 0030. Every request names its client version, and the Worker enforces the floor

- Status: accepted; implemented in the backend (the floor middleware); the core's header and the
  apps' update screen designed, not yet implemented
- Date: 2026-10-09
- Decided by: the maintainer, approving the plan that acted on architecture review #100
- Amends: [0002](0002-mls-end-to-end-encryption.md) (how `minClientVersion` forces an upgrade)

## Decision

`/health` publishes `minClientVersion` per platform, but no client read it and no route
enforced it, so the envelope and the commit claim could never change in a way an old client
cannot read.

- **Every request carries `Spjall-Client: <platform>/<version>`**, for example
  `android/0.2.0`. The core sets it on every HTTP request and on the socket upgrade. Each app
  passes its platform and its marketing version (`versionName`, `CFBundleShortVersionString`)
  to the core when it creates the client.
- **The Worker enforces the floor on every `/v1/*` route**, the public sign-in routes and the
  socket upgrade included. A version below `MIN_CLIENT_VERSION_<PLATFORM>` gets
  `426 client_too_old` with `{minVersion}`. A malformed header gets `400 invalid_request`.
- **A request without the header counts as version `0.1.0` on its platform's floor**, the
  version of every build made before the header existed. A floor of `0.1.0` lets them in;
  raising it shuts them out, with no special case. A request with no header and no platform
  is checked against the higher of the two floors.
- **The apps show an update screen** when the core reports `ClientTooOld`. The screen blocks
  every other screen and links to the store the app came from.
- **The floor is raised in its own change**, after the builds that send the header have
  reached the testers.

## Why

The floor is what lets a format change after a release: old clients are told to update
instead of failing on messages they cannot read. A floor that only `/health` publishes depends
on every client asking. Enforcing it on the routes leaves no client that has not asked.

## Rules out

- A route that serves a client below the floor.
- A version taken from the User-Agent or any other header than `Spjall-Client`.
