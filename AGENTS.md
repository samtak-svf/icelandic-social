# AGENTS.md: samtak-spjall

A community social platform and end-to-end encrypted messenger for Iceland on Android, iOS and the web, built by Samtak svf.
(`samtak-svf/icelandic-social`, AGPL-3.0). The product ships under a **brand** ("Hjal" today) that is
designed to be renamed cheaply; nothing outside `brand/` may depend on it.

Decisions are in [`docs/decisions/`](docs/decisions/), and they win over any plan or
issue where the two differ.

## The one structural rule: frozen ids vs brand

Display names are cheap to change and resource identifiers are not (the samtakamatt → samtak
rename, samtak-vefur decision 0036). So the repo keeps two things apart:

|                                                                                                                                           | Lives in                                   | Changes how                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| **Frozen identifiers**: bundle/application ids, App Group, Kenni client id, Worker/D1/R2/DO names, hosts, Firebase project, secret prefix | `identifiers/ids.json` (+ `ids.lock.json`) | Never, in practice. A change is a lock edit **and** a new `docs/decisions/*.md` in the same PR (`tooling/ids-freeze.mjs`) |
| **Brand**: display name, every user-visible sentence, colours, fonts, icons, external listing names                                       | `brand/<name>/`                            | Freely. Add a brand directory, pass `pnpm check`, switch `BRAND`                                                          |

Consequences, all enforced by `tooling/brand-leak-guard.mjs`:

- **Code never names the brand.** Not in a class, a resource, a log line or a test. Refer to a
  strings key (`app_name`) or a token (`color.primary`). Comments too: the guard reads them.
- **A frozen id never contains a brand term** (`samtak.spjall`, never a brand word). The
  Kotlin/Swift namespace is `samtak.spjall` because `is` is a hard keyword in Kotlin
  (decision 0004).
- The brand's own words are matched per word, inflections included, from
  `brand/<name>/brand.json` `leakTerms`. A word that only shares the stem (a person's name,
  another noun) is added to `allowPrefixes` **with its reason**. `allowPaths` lists the files
  allowed to talk about the brand (this file, `docs/**`).
- **A UI noun is a term, not a word in a string** (decision 0117). `brand/<name>/terms.is.json` holds its BÍN forms
  and agreement words, a string writes a token (`Stofna [[group.acc]]`), `brand:gen` expands it to plain text, and
  `check:brand` fails on a raw form, an unknown token or a retired word. Renaming one edits the table and regenerates.
  Comments and tests name the string key or say "the community", never the label.
- **Strings are whole sentences per brand**, never `{name}` interpolation: the name inflects.
  Key set, placeholders and plural categories (`one`, `other`) must match
  `brand/strings.contract.json` exactly (`tooling/brand-check.mjs`).
- **Factual claims are keyed to `claims` flags.** The residency sentence must contain exactly
  _"geymd varanlega innan ESB; unnin á netkerfi Cloudflare"_ (decision 0001). Never write
  that data is stored or processed in Iceland.
- **Contrast is computed, not eyeballed.** Every pair in `brand/contrast-pairs.json` must
  reach its WCAG level for every brand; a brand that fails does not pass `check:brand`.
- **Apps read generated files, never `brand/`.** `pnpm brand:gen` (`tooling/brand-gen.mjs`)
  writes Android resources and `BrandTokens.kt` in `android/core/brand/src/generated/`, `ios/Generated/`,
  `backend/src/brand.gen.ts` and `web/src/generated/brand/` (strings, Tailwind theme, fonts), icons
  included; all are committed and `check:brand-gen`
  fails when they differ by a byte. Never edit them by hand. The brand is `BRAND=<name>`, by
  default the only brand not starting with `_`. Generated files may name the active brand and
  no other one.
- **Apps read the Rust core from local paths, never from cargo or the network.**
  `android/core/crypto/libs/` and `ios/Packages/SpjallCore/` are gitignored and filled by
  `cargo xtask core <android|ios>` (a local build) or `cargo xtask fetch <android|ios>` (the
  published version pinned with SHA-256 in `core/artifact.lock.json`). App CI only fetches, so
  the lock always pins a release. No Gradle or Xcode file calls cargo (`check:core`). A new core is published by `node tooling/core-release.mjs <version>`
  (`docs/operations.md`), which tags the merged commit and writes the lock on a branch; the lock moves only by PR.
  A change to the wasm exports commits the regenerated `web/src/generated/core.d.ts` (the
  `web/core/spjall_wasm.d.ts` that `cargo xtask core web` builds) in the same PR; `core.yml` fails otherwise.

## Commands

```bash
pnpm install           # also installs the lefthook hooks
pnpm check             # lint, types, format, every guard CI runs (the list, and the stage each runs at: tooling/guards.json),
                       # knip; the line cap's shrink-only list is tooling/line-count.allow.json
pnpm brand:gen         # regenerate the platform files from brand/$BRAND
pnpm test              # guard tests (vitest); each guard is proven to fail when it should
                       # what deserves a test, and the known sources of noise: docs/testing.md
pnpm format            # oxfmt --write .
node tooling/ids-freeze.mjs --base origin/main   # what CI runs on a PR

# The Worker (backend/ and web/ are packages of the root workspace; `pnpm install` at the root covers them)
# One Worker serves both: /v1, /auth, /l, /oauth, /ops, /health and /.well-known go to the API
# (src/worker.ts), everything else to the web app (web/, TanStack Start), through src/index.ts
# (decision 0062); the list is API_PATHS in src/paths.ts.
pnpm --filter spjall-backend dev       # cf dev: Vite with the Cloudflare plugin, API and web on :8787
pnpm --filter spjall-backend build     # cf build: the Worker and the web app, into .cloudflare/output
pnpm --filter spjall-backend check     # cf workers types, tsc, api/openapi.json drift
pnpm --filter spjall-backend test      # vitest inside workerd (@cloudflare/vitest-plugin)
pnpm --filter spjall-backend openapi   # regenerate api/openapi.json after a zod change ...
node tooling/web-api.mjs     # ... then the web client from it
cd backend && node scripts/ops.ts jobs   # way back, rollback, restores and jobs: docs/operations.md (0068)

# The web (web/ is a package of the root workspace; the Worker builds and serves it)
pnpm --filter spjall-web test   # unit tests (vitest)
pnpm --filter spjall-web e2e    # Playwright in Chromium against `cf dev --mode interop` (web.yml)
node tooling/mac-remote.mjs web   # the same on samtak-mac: fresh state, cf dev, Playwright (web/scripts/e2e.sh)

# The Rust core (core/ is a Cargo workspace; the toolchain is pinned in rust-toolchain.toml)
cd core && cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test
cargo xtask core android     # needs the NDK named in core/artifact.lock.json and cargo-ndk
cargo xtask core ios         # macOS only
GH_TOKEN=$(gh auth token) cargo xtask fetch android   # the pinned published artifact, checksum-verified;
                             # the repo is private, so its releases need a token (CI passes github.token)

# The apps (they read the core from the paths xtask fills, never build it). Gradle, Xcode and the
# emulator run on samtak-mac only, never on the Linux workstation (a local daemon fills its swap).
node tooling/mac-remote.mjs -- android/scripts/test.sh   # ktlint, detekt, lint (warnings are errors), unit tests, assembleDebug
node tooling/mac-remote.mjs -- 'cd android && ./gradlew <task>'   # any one Gradle task
ios/scripts/test.sh --prepare   # macOS only: the iOS tests, as ios.yml runs them (runs lint.sh first)
ios/scripts/lint.sh             # macOS only: swift-format --strict, the same command ios.yml runs
node tooling/mac-remote.mjs android   # the Android checks and emulator tests on that Mac (`-- android/scripts/test.sh` alone: check + assembleDebug)
node tooling/mac-remote.mjs     # the same from Linux, on Samtak's own Mac over ssh (set up by tooling/mac-bootstrap.sh)
```

A debug Android build talks to a local `pnpm --filter spjall-backend dev` (`cf dev`) with `spjall.debugApiBaseUrl=http://10.0.2.2:8787`
in `android/local.properties` (gitignored) or `SPJALL_DEBUG_API_BASE_URL`.

The core vendors OpenSSL (rusqlite's `bundled-sqlcipher-vendored-openssl`), so its build needs
perl with `FindBin` and `IPC::Cmd`; on Fedora, `dnf install perl-FindBin perl-IPC-Cmd`. Each
git worktree builds its own `core/target` of several GB, so a worktree under a small `/tmp`
tmpfs runs out of space: point `CARGO_TARGET_DIR` at one shared directory outside `/tmp`
(e.g. `~/.cache/spjall-target`) for every worktree.

**The contract (decisions 0005, 0097).** zod in `backend/src/api/` is the source. `api/openapi.json`
and the web client `web/src/generated/api.ts` are generated and committed; the apps have no
generated client, they reach the server through the Rust core. `contract.yml` fails when either is stale, and `oasdiff breaking` against the base fails unless the PR has the label
`api: breaking`.

**Contract changes may run side by side when they are in different domains** (#397). The generated files
and the migration number are the only things two such branches share, and the branch that lands second runs
`node tooling/contract-rebase.mjs`: it rebases on `origin/main`, moves the branch's own migrations above
main's, regenerates the contract and commits that, with nothing to edit by hand. Two branches changing the
same source file still stop at the rebase, for a person. `migration-guard --base` refuses a number main has passed.

**Limits (decision 0123).** A limit a client and the server share lives in `api/limits.json`, and `tooling/limits-gen.mjs`
writes it to every platform (`check:limits`). A text's length is its code points; each platform has one helper for it.

Tooling is plain `.mjs` with `// @ts-check` and JSDoc, type-checked by `tsc --noEmit`
(`checkJs`). Node ≥ 24.2 (`import.meta.main`). pnpm, one workspace (the root and `backend/`)
with one lockfile; build scripts are allowed only for the root `pnpm.onlyBuiltDependencies`.

## Git

- **Feature branch + PR, never `main`.** Lefthook refuses a commit or push on `main`.
- **Conventional commits** (`feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`).
- **Never `--no-verify`**, `LEFTHOOK=0` or `core.hooksPath` tricks. A hook that fails for an
  environmental reason is fixed, not stepped around.
- **No AI authorship markers**, anywhere: no co-author trailer naming an AI, no
  "Generated with" footer, no AI byline. Commits and PRs credit only the human accountable.
  Enforced by the `commit-msg` hook and `.github/workflows/ai-authorship.yml`.
- **Stage explicit paths.** Never `git add -A` / `git add .`.

## PII

**Kennitölur and phone numbers never enter git**, including tests, fixtures, logs and notes.
`tooling/pii-guard.mjs` (pre-commit on staged files, CI on the whole tree) finds a person's
kennitala by its check digit and an Icelandic number by `+354`. Build sample values at
runtime in tests so the file itself holds none. Real data goes in the gitignored `private/`.

**No PII in logs** (decision 0008): Workers Logs are processed outside the EU boundary, so a
log line carries ids and counts, never a kennitala, a phone number, a name, a message or a
push token.

## Public repository

**No other messenger app is named here** (decision 0073): not in files, commit messages, PR
titles and bodies, or issues. Write "an established messenger" or describe the behaviour. A
named comparison lives only in the gitignored `private/comparison/`. `tooling/peer-name-guard.mjs`
checks staged files, commit messages, the whole tree and every PR; a new name goes into
`tooling/peer-names.json` as the hash `node tooling/peer-name-guard.mjs --hash <name>` prints.

## Icelandic text

User-facing strings are Icelandic and live only in `brand/<name>/strings.is.json`, with the nouns
they share in `terms.is.json` beside it. No
þankastrik (em dash, or spaced en dash) in them: `tooling/thankastrik.mjs`. An unspaced en
dash in a range (`9–17`) is a millistrik and is fine. Everything else written here (code,
comments, docs, commits, PRs, issues) is English.

## Infrastructure

- **Cloudflare: Samtak's own account**, never another organisation's. Every stateful
  resource is created in the **EU jurisdiction**: `cf d1 create --name … --jurisdiction eu`,
  `cf r2 buckets create --name … --cf-r2-jurisdiction eu`. A jurisdiction can only be set at
  creation. Durable Objects are pinned **per object id in code**:
  `env.CONVERSATION.jurisdiction("eu").getByName(…)`; a bare `idFromName` or `getByName` on
  the namespace is a residency bug (decision 0001).
- **Only `backend/src/env/` reads a binding, var or secret, and only it makes DO stubs**
  (`tooling/seam-guard.mjs`). `tooling/jurisdiction-check.mjs` checks that
  `backend/cloudflare.config.ts` names the frozen ids with R2 jurisdiction `eu`; with `--live` (CI,
  read-only token) it asks the Cloudflare API whether D1 and R2 really are in the EU.
- Local workerd does not implement DO jurisdictions: `jurisdiction()` throws there. Tests wrap
  the namespace (`backend/test/shared/env.test.ts`) instead of loosening the seam.
- **Never deploy before D1 and R2 exist.** `cf deploy` provisions a missing one without a
  jurisdiction, so every deploy runs `cf deploy --no-provision` behind
  `jurisdiction-check.mjs --deploy`. The creation commands are in `backend/README.md`.
- **No Cloudflare Queues** (no jurisdiction). Nothing personal is stored outside D1, R2 and
  the Durable Objects.
- **Secrets** live in the maintainer's GCP vault under the prefix `samtak-spjall-`, and
  nowhere in the repo. Signing material for a whole team goes in a GitHub environment, never
  in repo secrets. gitleaks runs pre-commit and in CI.
- Creating Cloudflare, Firebase, Apple, Play or Kenni resources, and DNS, is Guðröður's
  step. Agents prepare the exact commands and values, they do not run them. One standing
  exception, approved 2026-10-08: the first-deploy steps in `backend/README.md` (EU D1/R2, the
  R2 lifecycle rule, the API tokens, the custom domain). A second, approved 2026-10-10: an
  agent may dispatch a `production` deploy of merged `main` and approve its run, then checks
  `/health`.

## Decision records

`docs/decisions/NNNN-slug.md`, numbered, never renumbered. A record states the decision, why,
and what it rules out. A superseded record is kept and marked, not deleted.

Each record opens with `# NNNN. Title` and a header list: `- Status:` (`accepted`, with
"implemented …", "designed, not yet implemented", "deferred" or "amended by NNNN" when that
applies; the test refuses any other state, so a status is updated in the PR that lands the work),
`- Date:` and `- Decided by:` (a person, never an agent), then any `Amended by`, `Supersedes` or
`Closes` lines. The body starts at `## Decision`; `tooling/tests/decisions.test.mjs` holds this.

**v1 scope is [0009](docs/decisions/0009-v1-scope.md).** A feature outside its table needs a
new record before any code.

**Store accounts are Samtak svf.'s own ([0010](docs/decisions/0010-samtak-own-store-accounts.md)).**
Nothing is registered on another organisation's Apple team or Play account. The enrollment
steps are in `docs/store-accounts/`, and every one of them is Guðröður's.
