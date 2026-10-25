# Testing

A failing test should mean a real defect. This page says where tests earn their cost here,
and which failures have so far been noise, so the suite grows without becoming heavy.

## What a failed run has caught so far

A sample of 29 failed CI runs (2026-10-10):

| Cause                                                           | Runs |
| --------------------------------------------------------------- | ---: |
| A real problem caught by the compiler, the contract or a guard  |    5 |
| Timing in a test (retention clock, MLS epoch, rate limit)       |    6 |
| CI environment (emulator, simulator keychain, TestFlight, bots) |    7 |
| The test or its fixture was wrong                               |    3 |
| Lint, format or decision-record format                          |    5 |
| Dependency or tooling                                           |    2 |
| Process guard                                                   |    1 |
| A product bug caught by a unit or integration test              |    0 |

Types, the zod contract and the guards caught every real defect in the sample. Tests should
be judged by the same standard: a test that cannot name the bug it would catch is a cost.

## Where tests belong

Where a wrong answer harms a person:

- **Crypto and membership**: MLS commits, device add and removal, key packages.
- **Sign-in and identity**: Google and Kenni, the merge on link (0035), device tokens.
- **PII**: no kennitala, phone number or message in a log line or in git (0008).
- **Privacy**: what a person deleted or hid stays gone, with no copy on another device (0040).
- **Residency**: D1, R2 and Durable Objects in the EU jurisdiction (0001).
- **Delivery**: ordering, retention, read and typing state.

Rules for a new test:

- Name the bug it catches, in its name or a comment.
- One rule per test, with table rows for its cases.
- Use the real store (workerd D1, SQLCipher), never a mock of our own code.
- No test of layout or shape. A rule about shape becomes a guard or a lint rule. The
  one exception is the screenshot tests below, which hold how a screen looks.

## Screenshot tests (Android)

Roborazzi renders Compose screens on the JVM (Robolectric, native graphics) and compares
them pixel by pixel with committed images. The tests live next to the unit tests, named
`<Screen>ScreenshotTest.kt` (e.g. `app/src/test/kotlin/.../conversations/ConversationsScreenshotTest.kt`),
and their images in `android/app/src/test/screenshots/<Class>.<method>.png`, one per test.
Each test fixes Android 36, the Icelandic locale, a Pixel 5 screen and font scale 1
(`SCREENSHOT_SDK`, `SCREENSHOT_DEVICE`); the fonts are the brand's bundled files, and a
timestamp comes from a past year so the row stamp never moves.

- **Verify**: every unit test run compares (`roborazzi.test.verify=true` in
  `android/gradle.properties`), so `./gradlew check` and CI fail on any changed pixel. A
  failure's actual and diff images are in `app/build/outputs/roborazzi/` (uploaded by CI).
- **Record**: `./gradlew :app:recordRoborazziDebug`, then look at every changed image before
  committing it. A brand switch or a new Robolectric SDK is a re-record.
- **Every new visual state in the UI pass gets an image**: a new screen, row kind, banner or
  empty state adds a test method in that screen's `ScreenshotTest`, with fake data built the
  way its instrumented test builds it.

## Known sources of noise, and what to do

1. **Durable Object timing.** Fake the clock and wait on alarm state, never on a sleep. Fix a
   flaky test within a day, or quarantine it: skip it, open an issue labelled
   `test: quarantined`, and add `{file, name, issue, until}` to `tooling/quarantine.json`
   with `until` at most 14 days ahead. `check:quarantine` fails on a skip with no entry and
   on an entry past its `until`, so a quarantine ends in a fix or a deliberate deletion. A
   test that is not meant to run in the suite (a fixture writer, the interop job) gets a
   `reason` instead.
2. **Interop fixture drift.** Build interop accounts and headers with the apps' own helpers,
   and update the fixture in the PR that changes the behaviour.
3. **A new core breaks the apps.** Compile both apps against a local core build
   (`cargo xtask core`) before tagging `core-v*`.
4. **Emulator and simulator.** Keep instrumented tests few, and read a boot failure as
   environment. `connectedAndroidTest` uninstalls the app, so a manual sign-in on that
   emulator is lost; scope a run to one class with
   `-Pandroid.testInstrumentationRunnerArguments.class=…`.
   The emulator never runs on the Linux workstation: `node tooling/mac-remote.mjs --
   android/scripts/test.sh --connected` boots the headless `spjall-test` AVD (api 34, as
   `android.yml` does) on Samtak's Mac, runs `connectedDebugAndroidTest`, stops only the
   emulator it started, and fails if no test ran.
5. **Style-only failures.** Format on commit (`pnpm format`, `ktlintFormat`), and bump a
   formatter in its own PR with the reformat.
6. **Stale prose.** Keep a fact where a guard or a generator checks it, not only in prose.

## Proving a test works

Before trusting a test, break the rule it guards and watch it fail. The guards already do
this (`pnpm test`). Do the same, by hand, for a new test in a domain above.

## Critical rules

`tooling/critical-rules.json` lists the rules where a wrong answer harms a person, one
domain above each, with the decision record and the tests that hold it. `pnpm check`
(`check:critical-rules`) fails when a named test is renamed or removed, when a rule has
no test and no `gap` issue saying so, or when a decision it cites has no record. Add a
rule here when a decision creates one, and name its test in the same PR.

A test that catches a real bug gets `caught` (the PR or commit). On a PR, and before a
push, `critical-rules.mjs --base` refuses to drop such a test: it stays listed, or moves
to `retired` with the reason. A pruning pass that cuts tests by count loses exactly the
ones that mattered unless they are named.

### The rule drill

The registry says which tests hold a rule; the drill checks that they do. Each
`tooling/drills/<rule-id>.patch` is the smallest change that breaks that rule.
`node tooling/rule-drill.mjs [<rule-id>...]` applies each patch, runs the rule's tests,
reverts, and fails on a drill no test caught. `rule-drill.yml` runs every drill monthly
and opens an issue when one survives; `check:drills` in `pnpm check` keeps every patch
applying. The first run found one: the retention tests aged rows by the constant they
were checking, so 300 days passed as 30. Add a drill with each new critical rule.

## Coverage floor

Coverage is not a goal here, but a drop in a module that holds a critical rule is a test
that went missing. `tooling/coverage-floor.json` lists those modules (backend and core)
with the line and branch coverage each keeps, and `tooling/coverage-floor.mjs` fails
`backend.yml` or `core.yml` below it. It fails closed: no summary, or a listed module the
summary does not mention, fails too. `pnpm --filter spjall-backend coverage` (istanbul; the
workers pool does not support v8) and `cargo llvm-cov --workspace --json --summary-only
--output-path ../coverage/core-summary.json` in `core/` produce the summaries. A floor sits one
point under what `--record` measured, because a Durable Object alarm racing a test moves a
branch between runs. Raise a floor with `--record` in a PR of its own; lowering one says why in that PR. The apps are left
out: their critical logic is in the core (0022), and UI coverage measures layout.

## Where CI runs

While the repository is private, a hosted job draws on the organisation's monthly Actions
minutes, and macOS bills ten times Linux. So the PR checks run on Samtak's own Mac mini
(`samtak-mac`, two organisation runner instances), chosen by four repository variables:

| Variable                  | Jobs                                                | Value on the Mac                                     |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `RUNNER_LABELS`           | the build and test jobs                             | `["self-hosted","macOS","ARM64","samtak-mac"]`       |
| `GUARD_RUNNER_LABELS`     | the short guards (authorship, peer names, gitleaks) | the same                                             |
| `EXCLUSIVE_RUNNER_LABELS` | the Android device job only                         | the same plus `spjall-exclusive`, held by one runner |
| `MAC_RUNNER_LABELS`       | the iOS tests                                       | the same as `RUNNER_LABELS`                          |

- **Unset means hosted.** Every lane falls back to `ubuntu-latest`, so deleting a variable moves its
  jobs back to GitHub with no workflow change. A PR from a fork always runs hosted.
- **The exclusive lane** exists because the Android emulator is one AVD, and it reaches the dev
  Worker at the fixed `10.0.2.2:8787`: only the Android device job uses it. Only one runner
  carries the `spjall-exclusive` label, so those jobs queue instead of colliding. The runners
  belong to the organisation, so the label is set on its endpoint
  (`gh api orgs/samtak-svf/actions/runners/<id>/labels`); the repository's endpoint answers 404.
  `tooling/mac-remote.mjs android` uses the same AVD and is not serialised against CI.
- **web and interop do not queue on it.** `backend/scripts/dev-worker.sh` starts the Worker on a
  free port per run (`SPJALL_DEV_PORT`, read by `backend/dev-origin.ts`, exported to the tests as
  `SPJALL_DEV_URL`), so two Workers share one machine. `tooling/workflow-guard.mjs` keeps a fixed
  `127.0.0.1:8787` out of the workflows and `EXCLUSIVE_RUNNER_LABELS` out of every workflow but
  `android.yml`. Run by hand, `cf dev` stays on 8787.
- **No secret reaches the Mac.** A job that reads a secret (the live jurisdiction check, deploys,
  store uploads, signing) names a hosted runner, and `tooling/workflow-guard.mjs` refuses one that
  reads a runner variable.
- Steps that download a binary pick the build from `RUNNER_OS` and `RUNNER_ARCH`, so a job runs
  on either lane.
- **The two runners share one user and home directory.** Anything a step installs under `~`
  races the other runner, so `pnpm/action-setup` installs into `$RUNNER_TEMP`, and
  `.github/actions/rust-toolchain` gives each runner its own `CARGO_HOME`
  (`~/.cargo-runners/<runner>`): with one `~/.cargo`, the post step of one job's
  `Swatinem/rust-cache` cleaned the registry and `cargo/bin` under a build running on the other
  runner. The rustup proxies and toolchains stay shared. `tooling/workflow-guard.mjs` puts the
  action before every rust-cache, `taiki-e/install-action` and `cargo install`. A server started
  in the background uses `(trap '' HUP; exec …) &`, because macOS `nohup` exits under the launchd
  runner ("can't detach from console"). The browser core builds its C with Homebrew's LLVM, since
  Apple's clang has no wasm32 target.
