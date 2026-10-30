# 0118. A staging Worker, behind a gate, on storage of its own

- Status: accepted; implemented in the PR that adds `.github/workflows/staging.yml`; the resources exist once the maintainer creates them
- Date: 2026-10-30
- Decided by: Guðröður Atli Jónsson (a staging Worker exists, on Samtak svf.'s account); the design is the overseer's
- Amends: [0032](0032-worker-moves-to-cf.md) (a second deployed entry exists, and it is not production's)

## Decision

The feed's load has to be measured against the real platform (decision 0116), which local
workerd is not. So one more Worker runs on Samtak's Cloudflare account: `spjall-api-staging`,
the `staging` mode of `backend/cloudflare.config.ts`, on a `workers.dev` address with no custom
domain. Its database, buckets and Durable Object namespaces are its own, every stateful one in
the EU (decision 0001), and its names are in `identifiers/ids.json`.

Its sign-in is the fake Kenni and Google. On a public address that would let anyone sign in as
anyone and store files on our account, so **a gate answers first**: a request without the
`STAGING_GATE` secret, as a header from a tool or a cookie one URL sets for a browser, gets an
empty 404 whatever its path, static files included, and with the secret unset every request
does. The gate and the fakes live in `backend/dev/`; production's entry stays `src/index.ts`
and no file under `backend/src/` imports from `dev/`.

**Staging's entry is `dev/staging.ts`, not `dev/worker.ts`.** The interop entry unpins each
Durable Object from the EU because local workerd throws on `jurisdiction()`. Deployed, that
would create objects outside the EU, which decision 0001 rules out. So staging runs the real
classes, whose stubs `src/env/` pins, and the two dev entries share `dev/routes.ts` and
`dev/oidc.ts`. The fake provider's codes carry their own grant, since the isolate that redeems
a code need not be the one that issued it.

**It reaches nothing of production's.** It binds no production resource, holds no push
credential, sets only its own `KENNITALA_HMAC_KEY` and its gate, and has no `OPS_TOKEN`, so
`/ops` answers 404. Both crons stay on: the measurement needs the load production has, the
expiries bound the storage, and without credentials a push job sends nothing.

`.github/workflows/staging.yml` deploys it from `main` with no approval environment, using a
token of its own that reaches no zone. `tooling/jurisdiction-check.mjs` holds all of this on
every `pnpm check`.

## Consequences

- Decision 0032's `--deploy` check still refuses any entry but `src/index.ts`: staging passes
  `--staging` instead, and the offline check holds every other mode to `src/index.ts`.
- The Worker writes the production host into its session cookies' contract and its callback
  URLs, so at staging's edge `dev/staging-app.ts` translates the request's own `Origin` to it
  and brings redirects back. Nothing under `src/` learns of staging's address.
- The address is not a secret and is never what protects staging: a `workers.dev` name can be
  guessed. It stays out of this repository and its public logs as a secret, and the gate is what
  holds.
- Staging may hold only made-up people and data (`docs/operations.md`). Nothing real goes there.
