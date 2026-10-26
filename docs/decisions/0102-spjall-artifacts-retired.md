# 0102. The frozen R2 id `spjall-artifacts` is retired

- Status: accepted; implemented
- Date: 2026-10-26
- Decided by: Guðröður
- Amends: [0013](0013-core-artifacts-as-github-releases.md) (it kept the id frozen, unused for now)

## Decision

- **`cloudflare.r2.artifacts` (`spjall-artifacts`) is removed** from `identifiers/ids.json`,
  `identifiers/ids.lock.json` and `identifiers/ids.schema.json`. The R2 ids that remain are
  `media` and `profiles`, and both are bound by the Worker.
- **The app core is distributed as GitHub releases of its `core-vX.Y.Z` tag**, pinned with
  SHA-256 in `core/artifact.lock.json` (0013). Nothing in the repo uses an R2 bucket for build
  artifacts.
- **`tooling/jurisdiction-check.mjs` loses its comment about an unbound frozen name**, since
  every frozen bucket is now one the Worker binds.

## Why

The bucket was planned for build artifacts before the core moved to GitHub releases. It was
never created (measured 2026-10-26: `wrangler r2 bucket list`, with and without
`--jurisdiction eu`, lists no `spjall-artifacts` on the account) and never bound: no `backend/` config, binding, script or workflow names it, and
the only places it appeared were the identifier files, the schema, a test and decision text.
Its git history adds nothing else. A frozen id that nothing uses promises a
bucket whose jurisdiction nobody checks, and it keeps the first line of 0013's reasoning alive
after the reason is gone.

## What it rules out

- A new bucket that reuses the name `spjall-artifacts`. If build artifacts ever need R2, the
  bucket gets a new id by its own record, created in the EU jurisdiction (0001) from the start.
- Treating a frozen id as a reservation. An id enters `identifiers/ids.json` when something
  binds it.
