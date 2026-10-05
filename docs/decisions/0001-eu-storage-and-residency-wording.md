# 0001. Data is stored in the EU on Cloudflare, and the app says exactly that

- Status: accepted
- Date: 2026-10-05
- Decided by: Guðröður

## Decision

The backend runs on Cloudflare (Samtak's personal account). Every stateful resource is in
Cloudflare's **EU jurisdiction**:

- D1 `spjall-db` and the R2 buckets are created with `--jurisdiction eu`. Cloudflare allows a
  jurisdiction only at creation; a resource created without it is replaced, not fixed.
- Durable Objects take their jurisdiction **per object id, in code**:
  `env.CONVERSATION.jurisdiction("eu").idFromName(name)`. There is no namespace-level
  setting in `wrangler.jsonc`, so a bare `env.CONVERSATION.idFromName(name)` silently
  creates a non-EU object. The plan (§4) said "the DO namespaces report `eu`"; that is not
  how the platform works, and this record corrects it.
- **No Cloudflare Queues** in v1: Queues have no jurisdiction.
- Nothing personal is stored outside D1, R2 and the Durable Objects.

The app's residency sentence is keyed to the `residency` claim flag and contains exactly:

> geymd varanlega innan ESB; unnin á netkerfi Cloudflare

## Why

The design board promised "Öll gögn vistuð í gagnaverum á Íslandi". No Icelandic data centre
offers what the backend needs at this size, so Guðröður chose Cloudflare EU (leið A) and the
claim was dropped. What the EU jurisdiction guarantees is narrower than "everything happens
in the EU": D1, R2 and DO data is durably stored, and those objects run, inside the EU, but
a Worker executes at whatever edge location receives the request, DO ids can appear in logs
processed elsewhere, and Workers Logs are outside the boundary (hence decision 0008). The
sentence says what is true and nothing more.

## Enforcement

- `tooling/brand-check.mjs` fails a brand whose `residency_claim` lacks the exact phrase.
- `tooling/jurisdiction-check.mjs` (backend PR) asks the Cloudflare REST API that D1 and R2
  report `eu`, in CI with a read-only token.
- The DO side cannot be read from the API, so it is a seam rule: only `backend/src/env/`
  turns a namespace into a stub, always via `.jurisdiction("eu")`, with a test that fails on
  a bare `idFromName` / `newUniqueId` anywhere else (`tooling/seam-guard.mjs`, backend PR).

## Rules out

Any copy saying data is stored or processed in Iceland; any Cloudflare product without a
jurisdiction holding personal data; a Durable Object stub created outside `src/env/`.
