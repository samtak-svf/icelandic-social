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
- **Residency**: D1, R2 and Durable Objects in the EU jurisdiction (0001).
- **Delivery**: ordering, retention, read and typing state.

Rules for a new test:

- Name the bug it catches, in its name or a comment.
- One rule per test, with table rows for its cases.
- Use the real store (workerd D1, SQLCipher), never a mock of our own code.
- No test of layout or shape. A rule about shape becomes a guard or a lint rule.

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
