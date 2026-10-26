# 0097. A generated client stays only where something consumes it

- Status: accepted; implemented in #269
- Date: 2026-10-26
- Decided by: Guðröður Atli Jónsson
- Amends: [0005](0005-contract-zod-openapi-generated-clients.md) (which left open whether the generated native clients stay)

## Decision

The generated native clients go. What stays of decision 0005:

- `api/openapi.json`, generated from the zod schemas in `backend/src/api/`, and its drift check;
- the web client `web/src/generated/api.ts` (`tooling/web-api.mjs`), which the web app imports;
- the `oasdiff breaking` check in `contract.yml` and `backend/test/contract.test.ts`.

What is removed: the Android module `:core:network` (the generated Kotlin REST client),
the Kotlin `WsFrame` and its emitter `tooling/ws-kotlin.mjs`, the iOS package `SpjallAPI`,
and the build entries that existed only for them (the openapi-generator and Kotlin
serialization Gradle plugins, the `check:ws-kotlin` script and its CI and hook steps).
The schema named `WsFrame` inside the spec and the web client is unaffected.

## Why

Nothing depended on them. Both apps talk to the backend only through the Rust core
(decision 0018), which owns its request and response types in `core/client/src/api.rs` and
receives raw frames from the socket (`account.onFrame`). The generated clients served
`/health` and a contract test that only they used, yet CI kept them current.

A future native REST client is generated into the core, so there is one HTTP surface for
every platform, not one per platform.

`tooling/tests/generated-outputs.test.mjs` keeps this honest: every generated output is
listed with the code that must read it, and the test fails for an output nobody reads.

## What it rules out

- A per-platform generated REST client or frame emitter in the apps. A native app needing a
  new endpoint gets it through the core.
- A generated output that no code reads. Add its consumer to the table in the same PR, or
  do not generate it.
