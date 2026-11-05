# Commands and build notes

The full command list, moved out of `AGENTS.md` (which keeps the rules). Run everything from the repository root unless a line says otherwise.

```bash
pnpm install           # also installs the lefthook hooks
pnpm check             # lint, types, format, every guard CI runs, in parallel (tooling/check.mjs reads the check:chain script;
                       # the stage each guard runs at: tooling/guards.json), knip; the line cap's shrink-only list is
                       # tooling/line-count.allow.json. Prints each step's output when it ends, then one summary line.
pnpm check:changed     # the same, with lint and format narrowed to the files changed against the merge base with origin/main;
                       # a step that cannot narrow runs in full. GUARDS_JOBS=n sets the concurrency.
pnpm run check:chain   # the same steps, one after another
pnpm brand:gen         # regenerate the platform files from brand/$BRAND
pnpm test              # guard tests (vitest); each guard is proven to fail when it should
                       # what deserves a test, and the known sources of noise: docs/testing.md
pnpm test:changed      # only the tests the diff against origin/main reaches (root, backend, web); the loop between one file and the whole suite
pnpm format            # oxfmt --write .
node tooling/ids-freeze.mjs --base origin/main   # what CI runs on a PR

# The Worker (backend/ and web/ are packages of the root workspace; `pnpm install` at the root covers them)
# One Worker serves both: /v1, /auth, /l, /oauth, /ops, /health and /.well-known go to the API
# (src/worker.ts), everything else to the web app (web/, TanStack Start), through src/index.ts
# (decision 0062); the list is API_PATHS in src/paths.ts.
pnpm --filter spjall-backend dev       # cf dev: Vite with the Cloudflare plugin, API and web on :8787
pnpm --filter spjall-backend build     # cf build: the Worker and the web app, into .cloudflare/output
pnpm --filter spjall-backend check     # cf workers types, tsc, api/openapi.json drift
pnpm --filter spjall-backend test      # vitest inside workerd (@cloudflare/vitest-plugin); the full suite, minutes on a loaded machine
# The fast loop while working: one file, or one test by name, from backend/ (7 to 22 s: cold start and a loaded machine are the slow end)
cd backend && pnpm exec vitest run test/shared/env.test.ts
pnpm --filter spjall-backend test:changed   # vitest run --changed origin/main: the tests whose imports the diff touches
cd backend && pnpm exec vitest run test/shared/env.test.ts -t "<part of the test name>"
pnpm --filter spjall-backend openapi   # regenerate api/openapi.json after a zod change ...
node tooling/web-api.mjs     # ... then the web client from it
cd backend && node scripts/ops.ts jobs   # way back, rollback, restores and jobs: docs/operations.md (0068)

# The web (web/ is a package of the root workspace; the Worker builds and serves it)
pnpm --filter spjall-web test   # unit tests (vitest)
pnpm --filter spjall-web test:changed   # only the unit tests the diff against origin/main reaches
pnpm --filter spjall-web e2e    # Playwright in Chromium against `cf dev --mode interop` (web.yml)
node tooling/mac-remote.mjs web   # the same on samtak-mac: fresh state, cf dev, Playwright (web/scripts/e2e.sh)

# The Rust core (core/ is a Cargo workspace; the toolchain is pinned in rust-toolchain.toml)
cd core && cargo fmt --all && cargo clippy --workspace --all-targets -- -D warnings && cargo test
cargo xtask core android     # needs the NDK named in core/artifact.lock.json and cargo-ndk
cargo xtask core ios         # macOS only
GH_TOKEN=$(gh auth token) cargo xtask fetch android   # the pinned published artifact, checksum-verified;
                             # the repo is public, so the token is optional: it only lifts the API rate limit (CI passes github.token)

# The apps (they read the core from the paths xtask fills, never build it). Gradle, Xcode and the
# emulator run on samtak-mac only, never on the Linux workstation (a local daemon fills its swap).
node tooling/mac-remote.mjs -- android/scripts/test.sh   # ktlint, detekt, lint (warnings are errors), unit tests, assembleDebug
node tooling/mac-remote.mjs -- 'cd android && ./gradlew <task>'   # any one Gradle task
ios/scripts/test.sh --prepare   # macOS only: the iOS tests, as ios.yml runs them (runs lint.sh first)
ios/scripts/lint.sh             # swift-format --strict, the same command ios.yml runs (needs xcrun or swift-format on PATH)
node tooling/native-lint.mjs    # ktlint and detekt over the Kotlin, swift-format over the Swift this branch changed; pre-push runs it
node tooling/mac-remote.mjs android   # the Android checks and emulator tests on that Mac (`-- android/scripts/test.sh` alone: check + assembleDebug)
node tooling/mac-remote.mjs     # the same from Linux, on Samtak's own Mac over ssh (set up by tooling/mac-bootstrap.sh)
```

## Notes

A debug Android build talks to a local `pnpm --filter spjall-backend dev` (`cf dev`) with `spjall.debugApiBaseUrl=http://10.0.2.2:8787`
in `android/local.properties` (gitignored) or `SPJALL_DEBUG_API_BASE_URL`.

The core vendors OpenSSL (rusqlite's `bundled-sqlcipher-vendored-openssl`), so its build needs
perl with `FindBin` and `IPC::Cmd`; on Fedora, `dnf install perl-FindBin perl-IPC-Cmd`. Each
git worktree builds its own `core/target` of several GB, so a worktree under a small `/tmp`
tmpfs runs out of space: point `CARGO_TARGET_DIR` at one shared directory outside `/tmp`
(e.g. `~/.cache/spjall-target`) for every worktree.

## Native lint

`tooling/native-lint.mjs` (pre-push) lints the Kotlin and Swift files a branch changed since main, with no Gradle
daemon: ktlint and detekt are plain command-line tools, so a style error fails in seconds on this machine and not
after a trip to the Mac. A tool that is missing is skipped with one line naming the workflow that checks the files
(`android.yml`, `ios.yml`); CI stays the gate.

On Fedora both release binaries run with the system Java 21 or newer; no root is needed. Use the versions the
Gradle plugins use (`android/gradle/libs.versions.toml`), because a newer ktlint adds rules the build does not have:

```sh
curl -fsSL -o ~/.local/bin/ktlint https://github.com/pinterest/ktlint/releases/download/1.7.1/ktlint && chmod +x ~/.local/bin/ktlint
mkdir -p ~/.local/share/detekt && curl -fsSL -o ~/.local/share/detekt/detekt-cli-all.jar \
  https://github.com/detekt/detekt/releases/download/v2.0.0-alpha.6/detekt-cli-2.0.0-alpha.6-all.jar
printf '#!/bin/sh\nexec java -jar "$HOME/.local/share/detekt/detekt-cli-all.jar" "$@"\n' > ~/.local/bin/detekt && chmod +x ~/.local/bin/detekt
```

detekt runs without type resolution and only on `src/main` and `src/test`, as the Gradle task does. swift-format
ships in Fedora's `swift-lang` package (`sudo dnf install swift-lang`, a large install); with it on PATH
`native-lint.mjs` lints the Swift a branch changed. On a machine without it, or without `xcrun`, the iOS check is the
`ios` workflow, or run `ios/scripts/lint.sh` on the Mac over the remote runner (`tooling/mac-remote.mjs`). `ktlint -F <file>` fixes
most style errors in place.

## The contract

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

## Tooling

Tooling is plain `.mjs` with `// @ts-check` and JSDoc, type-checked by `tsc --noEmit`
(`checkJs`). Node ≥ 24.2 (`import.meta.main`). pnpm, one workspace (the root, `backend/`, `web/`, `spikes/browser-storage` and `spikes/d1-workload`)
with one lockfile; build scripts are allowed only for the root `pnpm.onlyBuiltDependencies`.
