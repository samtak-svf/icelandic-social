# 0005. The API contract is zod → OpenAPI; REST clients are generated, WebSocket frames are emitted

- Status: accepted
- Date: 2026-10-05
- Decided by: Guðröður (plan), recorded at phase 0 after the generator spike the plan (§3) required

## Decision

- The source of truth is zod in `backend/src/api/`, served through `@hono/zod-openapi`.
  `api/openapi.json` (OpenAPI 3.1) is generated, committed, and drift-checked in CI; a
  breaking change against `main` (`oasdiff breaking`) needs the label `api: breaking`.
- **REST clients are generated at build time, never committed**: Swift with Apple's
  `swift-openapi-generator` build plugin (package `SpjallAPI`), Kotlin with
  `openapi-generator` (`kotlin`, library `jvm-okhttp4`, `kotlinx_serialization`) from a Gradle
  task in `android/core/network`.
- **WebSocket frames are one tagged union** (`oneOf` + `discriminator` on `type`) in the
  same spec, but the Kotlin side is **not** produced by openapi-generator: a small emitter in
  `tooling/` writes a `@Serializable sealed interface` with `@SerialName` per frame type, and
  its drift check runs with the others. Swift keeps the generated union.
- Contract rules that fall out of the spike:
  - no `oneOf` in REST request or response bodies;
  - binary in JSON is a base64 **string** (`z.base64()`), never `format: byte`;
  - dates are RFC 3339 strings; the Swift client decodes with `.iso8601`;
  - optional query numbers are declared so they do not emit as nullable;
  - Kotlin package `samtak.spjall.api` (decision 0004).

## The spike

A three-route spec (GET with path and query parameters, POST with a body, the WS frame union
with two members) generated from zod, then compiled and decoded against sample JSON:

|                                        | REST models | WS frame union                                                                                  | Notes                                                                                                                                                    |
| -------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Swift 6.4, swift-openapi-generator 1.x | ✓ decode    | ✓ decode                                                                                        | needs one `.swift` file in the target (`@_exported import OpenAPIRuntime`); dates need `.iso8601`; "public import not used" warnings from generated code |
| Kotlin, openapi-generator 7.25.0       | ✓ decode    | ✗ runtime: "Serializer for subclass 'hello' is not found in the polymorphic scope of 'WsFrame'" | 3.1 support marked beta; `format: byte` serialised as a JSON array; `package is.…` does not compile                                                      |

The REST path works on both platforms, so the pipeline is adopted. The one hard failure is
the polymorphic union in Kotlin, which is exactly the shape the WS protocol is built on;
patching generator templates would be a fork to maintain, while a sealed-interface emitter
is about a hundred lines with a test, so the emitter wins.

## Rules out

Hand-written REST models on either platform; committed generated clients; a second schema
language for WS frames.
