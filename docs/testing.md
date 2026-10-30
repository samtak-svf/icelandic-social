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

### Where a test file goes

A test lives where the code it tests lives, so finding one means knowing the code, not the
history of the suite.

| Language                    | Test file                                     | Lives in                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend (Worker)            | `*.test.ts`, run in workerd                   | `backend/test/modules/<module>/` for a module, `backend/test/identity/` for identity, `backend/test/api/` for the app, contract, routes and middleware, `backend/test/shared/` for `src/shared/`, the env seam and the schema. Helpers and setup (`support.ts`, `main.ts`, `people.ts`, `images.ts`, `mls.ts`, `oidc.ts`, `push.ts`, `socket.ts`, `setup.ts`, `worker.ts`) stay at `backend/test/`. |
| Web unit                    | `*.test.ts(x)`, vitest                        | Next to the source file it tests, in `web/src/`                                                                                                                                                                                                                                                                                                                                                     |
| Web end to end              | `*.spec.ts`, Playwright                       | `web/e2e/`                                                                                                                                                                                                                                                                                                                                                                                          |
| Android unit and screenshot | `*Test.kt`                                    | `android/app/src/test/kotlin/samtak/spjall/<feature>/`; images in `android/app/src/test/screenshots/`                                                                                                                                                                                                                                                                                               |
| Android instrumented        | `*Test.kt`                                    | `android/app/src/androidTest/kotlin/samtak/spjall/` (and the same in `android/core/crypto/src/`)                                                                                                                                                                                                                                                                                                    |
| iOS                         | `*Tests.swift`                                | `ios/Tests/`, one flat directory                                                                                                                                                                                                                                                                                                                                                                    |
| Core (Rust)                 | `#[cfg(test)]` module, or an integration file | A unit test in the `src/` file it tests; an integration test in `core/<crate>/tests/<topic>.rs`, with helpers in `tests/support/`                                                                                                                                                                                                                                                                   |

A backend test goes with the code whose rule it holds, not the route it happens to call:
the test of a reaction rule is in `modules/social/` although it goes through `/v1`. A test
that spans modules goes with the module that starts the flow.

## A test reads the string

A test takes a label from the generated strings (`strings.community_create` on the web, `getString(R.string.…)` on
Android) instead of repeating it, so renaming a UI word touches no test (decision 0117). A word a test types as user
content, such as a post body or a conversation's name, is data and may be anything.

## Screenshot tests (Android)

Roborazzi renders Compose screens on the JVM (Robolectric, native graphics) and compares
them pixel by pixel with committed images. The tests live next to the unit tests, named
`<Screen>ScreenshotTest.kt` (e.g. `app/src/test/kotlin/.../conversations/ConversationsScreenshotTest.kt`),
and their images in `android/app/src/test/screenshots/<Class>.<method>.png`, one per test.
Each test fixes Android 36, the Icelandic locale, a Pixel 5 screen and font scale 1
(`SCREENSHOT_SDK`, `SCREENSHOT_DEVICE`); the fonts are the brand's bundled files, and a
timestamp comes from a past year so the row stamp never moves.

- **Verify**: every unit test run compares (`roborazzi.test.verify=true` in
  `android/gradle.properties`), so `android/scripts/test.sh` (on the Mac) and CI fail on any changed pixel. A
  failure's actual and diff images are in `app/build/outputs/roborazzi/` (uploaded by CI).
- **Record** on the Mac with `node tooling/mac-remote.mjs record`: it copies the changed images into
  `android/app/src/test/screenshots/` and names them. Look at every one before committing it. A brand switch, a new Robolectric SDK or a renamed term (decision 0117) is a re-record.
- **Every new visual state in the UI pass gets an image**: a new screen, row kind, banner or
  empty state adds a test method in that screen's `ScreenshotTest`, with fake data built the
  way its instrumented test builds it.

## Checking by hand on a phone

Some defects show only on a real screen: a long name that wraps, an icon that is the same for
every row. Each release's hand checks are a list in the gitignored `private/e2e/`, with the
screenshots of the run beside it. Messages go only between test accounts.

**A phone that holds a real account takes the debug build beside the store install, never over
it.** The debug build type has its own application id (`.debug` suffix) and its own URL scheme,
so neither app can answer the other's sign-in, and it talks only to a local Worker over
`adb reverse`. Set the fakes' redirects to its scheme with a `POST` to
`/dev/app-scheme?scheme=<store scheme>.debug` on that Worker. Before any install, read
`adb shell pm list packages` and the APK's own id, and confirm they differ. The store install is
never uninstalled, cleared, installed over, or opened to send anything. Such a walk does not
prove push, the store update path or R8.

- **Android over wireless debugging.** `adb mdns services` lists the phone as an
  `_adb-tls-connect._tcp` service, and `adb connect <ip:port>` joins it. The port changes each
  time wireless debugging restarts on the phone, and the phone can drop it while it sleeps. A
  `Connection refused` on the listed port therefore means wireless debugging has to be switched
  on again on the phone. It is not a defect in the app. Downscale a screenshot before reading it
  (`magick in.png -resize 600x out.png`).
- **The iOS simulator cannot be walked through yet.** `xcrun simctl` boots, installs and takes
  screenshots, but it cannot tap, and sign-in goes through `ASWebAuthenticationSession`, a
  system sheet. There is no UI-test target, so walking through the app in the simulator needs an
  XCUITest target first. Until then, a SwiftUI view is checked by eye in a one-off test. The
  test renders the view with `ImageRenderer` at a phone's width and writes the PNG to
  `private/`, as was done for the wrapping verified name. The rest waits for a TestFlight build
  on a real iPhone.

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

## The last store release against this Worker

A phone keeps its core until its owner updates. `old-client.yml` compiles
`tooling/old-client/old_client/` in a checkout of the core tag
`tooling/old-client/release.json` names, starts the Worker of the PR's tree, and reads through that
core's own decoding with that release's `Spjall-Client`, on an Android and an iOS device of one
account. It runs on a PR that touches `backend/` or `api/`, with no emulator and no secret.

**What it proves**, for notifications, the feed, a community's posts and a single post: every
answer decodes (one field the release cannot read fails the job, as it fails the page on a phone);
a notice with no community (a friend notice among them), a notice of a newer action and a removed post's tombstone are withheld from that build, and
the same reads as a current build show them, so the seed was real; what the release should see is
still there, a removal notice included; the unread count leaves out what the list leaves out.

**What it does not prove:** how an app draws any of it, its local store, push, or a screen. Those
stay with [Checking by hand on a phone](#checking-by-hand-on-a-phone), on an installed store build.
The check covers those four reads, not every route, and `release.json` carries the Android
and iOS release as one, because both shipped the same core so far.

Move `release.json` in the PR after a store release: its daily `recorded-release` job goes red when
the last `android-play` build has another core, and never fails a PR for it.

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

The repository is public, so hosted Linux and macOS runners cost nothing. The build, test and guard
jobs run hosted. Two lanes use Samtak's own Mac mini (`samtak-mac`, two organisation runner
instances), for its speed and its arm64 AVD, each chosen by a repository variable:

| Variable                  | Jobs                                                | Value                                                                                 |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `RUNNER_LABELS`           | the build and test jobs                             | unset (hosted)                                                                        |
| `GUARD_RUNNER_LABELS`     | the short guards (authorship, peer names, gitleaks) | unset (hosted)                                                                        |
| `EXCLUSIVE_RUNNER_LABELS` | the Android device job on main, never on a PR       | `["self-hosted","macOS","ARM64","samtak-mac","spjall-exclusive"]`, held by one runner |
| `MAC_RUNNER_LABELS`       | the iOS tests and the core's iOS build              | `["self-hosted","macOS","ARM64","samtak-mac"]`                                        |

- **Unset means hosted.** Every lane falls back to `ubuntu-latest`, so deleting a variable moves its
  jobs back to GitHub with no workflow change. A PR from a fork always runs hosted.
- **Every job's total wait came down except `web`, which went up by half a minute at the median.**
  Medians in minutes of queue plus run, p90 in brackets, on PRs. Before is the Macs: the newest 60
  successful runs since 10-29 (the #393 baseline), and 10-23 to 10-30 for the core and device jobs.
  After is 18:00 to 22:20 on 10-30, 18 merged PRs, core and contract among them, so few samples on
  some rows, and read with `tooling/ci-measure.mjs`.

  | Job             | Before | After       | Lane now                                |
  | --------------- | ------ | ----------- | --------------------------------------- |
  | `android/build` | 13.4   | 1.5 (6.7)   | hosted                                  |
  | `drill`         | 14.5   | 2.9 (6.2)   | hosted                                  |
  | `backend/test`  | 5.0    | 2.6 (3.0)   | hosted                                  |
  | `interop`       | 6.2    | 3.4 (5.1)   | hosted                                  |
  | `web`           | 5.5    | 6.0 (6.2)   | hosted, two shards                      |
  | core `android`  | 20.3   | 19.2 (20.6) | hosted                                  |
  | `device`        | 11.8   | 4.9 (5.1)   | hosted on a PR, the Mac's AVD otherwise |
  | `ios/build`     | 3.4    | 1.6 (3.5)   | the Mac                                 |
  | core `ios`      | 19.7   | 11.1 (35.9) | the Mac                                 |

- **`web` runs as two Playwright shards.** One hosted job took 10.2 min, 8 of them Playwright on
  the runner's two workers. Two shards, each with its own Worker, take 6.0 (6.2), first leg created
  to last leg done. That is n=2 and one of the two is a drill with a deliberately failing shard;
  the passing run took 6.2, and the one merge since took 5.8. More workers on one runner were
  rejected: the 5 s assertions give way under CPU load (#355). `proof` needs both shards, shown by
  a drill.
- **`web` stays hosted although it is slower than its baseline.** The 5.5 is 1.7 of run plus 3.8 of
  wait, from that short sample. The same job on the Mac over 10-23 to 10-30 took 3.6 of run plus 5.6
  of wait, 9.8 in total with a p90 of 27.7 (n=61), and the latest Mac run of today's suite took
  4.7. So an idle Mac is about a minute faster and a busy one far slower. Going back returns that
  wait and takes the Mac from the iOS jobs, which took 9.0 to 12.6 once the Linux jobs had left it.
- **iOS stays on the Mac.** `ios/build` took 12.0 min on `macos-26` against 1.6, its build step
  505 s against 67 s, and core `ios` 18 to 23 against 11.1. A Free organisation also gets 5
  concurrent macOS jobs out of 20 (GitHub Actions limits). The 35.9 on core `ios` is one run of
  18:13, while Linux jobs were still on the Mac; the five runs from 19:58 took 9.0 to 12.6.
- **The exclusive lane** exists because the Android emulator is one AVD, and it reaches the dev
  Worker at the fixed `10.0.2.2:8787`: only the Android device job uses it. Only one runner
  carries the `spjall-exclusive` label, so those jobs queue instead of colliding. The runners
  belong to the organisation, so the label is set on its endpoint
  (`gh api orgs/samtak-svf/actions/runners/<id>/labels`); the repository's endpoint answers 404.
  `tooling/mac-remote.mjs android` uses the same AVD and is not serialised against CI.
- **A PR's device job is hosted, every other one takes the Mac.** Over 10-23 to 10-30 the job on a
  PR took a median of 11.8 min (p90 29.9) on the exclusive lane, 8.2 of them waiting, and 4.5
  (p90 5.7) hosted, with the same failure rate (12 and 13%). It set the pace of a PR: 14.7 min
  (p90 43.3) against 4.8 (p90 5.7). The hosted emulator is x86_64 and a phone is arm64, so a merge
  that runs, the daily run and a manual run stay on the AVD: CI still loads the arm64 core, at most
  a day after the commit that broke it. Both lanes run the same tests, and both fail on none
  (`android/scripts/connected-count.sh`).
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
- **A merge does not repeat what its PR proved.** A green PR run of a workflow leaves a marker
  named from the workflow file and every tracked file under its push filter
  (`tooling/tree-proof.mjs`). The push of the merge looks for that name, and when it finds one from
  this repository, the jobs start nothing. Two PRs merged side by side land a tree neither tested,
  so the name differs and the merge runs in full; so does any failure of the gate itself. Still run
  on every push: gitleaks in `ci.yml`, the core's tags and publish, the jurisdiction check. A daily
  scheduled run keeps the caches a PR restores from main warm, and tests main as it stands. A merge
  queue was the other way to do this, and it was not chosen: it runs on `merge_group`, for which
  GitHub documents no path filter, and it serialises merges (GitHub changelog, 2023-07-12).
  `tooling/workflow-guard.mjs` rule 12 holds the wiring.
- **A job hook reaps what a cancelled job leaves.** Cancelling kills the step's shell, not its
  process group, so `workerd` and its `pnpm`/`node` parents survived (#318).
  `tooling/mac-runner-hook.sh` runs as both `ACTIONS_RUNNER_HOOK_JOB_STARTED` and
  `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`, so no process whose command line lies under this
  runner's `_work/` survives from one job into the next; the other runner's `_work` and
  everything outside any `_work` are left alone. There is one copy, sent to
  `~/.local/libexec/spjall/` over ssh; `tooling/mac-bootstrap.sh` (header) has the command and
  wires it into each samtak-svf runner's `.env`, restarting a runner that is idle.
- **The two runners share one user and home directory.** Anything a step installs under `~`
  races the other runner, so `pnpm/action-setup` installs into `$RUNNER_TEMP`, and
  `.github/actions/rust-toolchain` gives each runner its own `CARGO_HOME`
  (`~/.cargo-runners/<runner>`): with one `~/.cargo`, the post step of one job's
  `Swatinem/rust-cache` cleaned the registry and `cargo/bin` under a build running on the other
  runner. The rustup proxies and toolchains stay shared. `tooling/workflow-guard.mjs` puts the
  action before every rust-cache, `taiki-e/install-action` and `cargo install`. A server started
  in the background uses `(trap '' HUP; exec …) &`, because macOS `nohup` exits under the launchd
  runner ("can't detach from console"). The browser core builds its C with Homebrew's LLVM, since
  Apple's clang has no wasm32 target: `.github/actions/rust-toolchain` sets the compiler when a job
  asks for the wasm32 target on macOS. The core's Android job installs the NDK into the Mac's
  shared SDK once and reuses it.
