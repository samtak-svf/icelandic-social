# 0037. Every response carries a request id, and every error names it

- Status: accepted; implemented in the backend (#151), the core (0.14.0) and the apps
- Date: 2026-10-10
- Decided by: the maintainer, choosing it from a comparison with an established API's error
  trace id
- Builds on: [0005](0005-contract-zod-openapi-generated-clients.md),
  [0008](0008-no-pii-in-logs.md)

## Decision

Each request the Worker serves gets an id, so a person who hits an error can quote something
support can find.

- **The id is Cloudflare's ray id** (`cf-ray`) when the request has one that looks like one
  (letters, digits and dashes, at most 64), and otherwise a new `crypto.randomUUID()`. Every
  request served by Cloudflare has a ray id, so in production the id is the one the dashboard
  and Workers Logs already show for the request.
- **It is returned on every response** as the `x-request-id` header, success or not, the link
  host's pages included. A WebSocket upgrade's 101 is the one exception: it cannot be copied
  to add a header.
- **It is in every error body** as the required field `requestId` of `ApiError`, next to
  `error` (and `minVersion` with a 426). Every error answer is built by one helper,
  `fail()` in `backend/src/errors.ts`; `tooling/seam-guard.mjs` refuses an error body built
  anywhere else. The schema's `invalid_request`, a body that is not JSON, a path no route
  serves (`not_found`) and an exception (`internal_error`, 500) go through it too.
- **It is logged with the error line**: an exception is logged as `request.failed` with the
  id, the status and the code, never the exception's message; the refusals that already had a
  line (sign-in, linking, rate limits) carry the id as well.
- **The core keeps it**: a refused request is `ApiError::Refused` with `request_id`, and
  `CoreError::Refused` carries it across the FFI, so the apps can show it next to the error.
  An older server's refusal has none.
- **The apps show it**: a refusal's card has a small, selectable line under the message naming
  the id (`problem_request_id`), so a tester can quote it; a failure no server answered has none.

The id is opaque and random: it names a request, never a person, so decision 0008 allows it in
a log line and `log.ts` lets it through its allow list and redaction like any other opaque id.

## Why

An error a person sees in the app today says what went wrong but gives support nothing to
look up: logs carry no names (0008), so "it failed for me at around three" cannot be matched
to a line. An established API puts a trace id in every error for this; the ray id costs
nothing, is already on every Cloudflare request and is what Cloudflare's own tooling is
searched by.

Adding a required field to an error body is additive for a client: the apps and the core
read `error` and ignore the rest, so no build stops working.

## Rules out

- Putting the id in a success body. A success answer's shape is the route's own; the header
  is there for anyone who needs the id of a request that went well.
- Any id derived from the account, the device, the address or anything else the request
  carries, beyond the ray id Cloudflare itself assigns. An id that could be traced back to a
  person would be personal data in every log line it is on.
- An error answer built outside `fail()`, and so without the id.
