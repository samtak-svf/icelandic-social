# 0128. Every apps release goes to testers

- Status: accepted; implemented (#399)
- Date: 2026-11-03
- Decided by: the overseer, on Guðröður Atli Jónsson's order of 2026-11-03; his to overturn

## Decision

**Each version change merged to `main` uploads to Play internal testing and to TestFlight with no
hand step.** `apps-release.yml` runs on a push to `main` that touches `android/app/build.gradle.kts`
or `ios/project.yml`. It reads `versionName` and `MARKETING_VERSION`, fails when the two differ
(both platforms share one version), and, when either changed against the previous commit, calls
`android-play.yml` and `ios-testflight.yml` with `upload: true`. The testers are the ones already
added by hand ([0084](0084-testers-reach-the-maintainer-directly.md)); nothing here adds or
invites anyone.

**The smoke list is run per release.** The list in `docs/testing.md` ("Release smoke list") is walked
on a physical phone from the tester track, and its result is recorded as pass or fail on #399.

**A manual dispatch of either workflow stays**, for a re-upload.

## Why

A release that waits for a hand step waits for the one person who has one, and the testers then run
a build older than `main`. The signing workflows already exist and are safe to call; only the
trigger was missing.

## Rules out

- Promotion to a production track without a person: this reaches the internal and TestFlight
  testers only.
- Signing on self-hosted runners: the signing jobs keep literal GitHub-hosted runners, and
  `tooling/workflow-guard.mjs` (rule 13) fails a signing workflow or a caller of one that names a
  variable, matrix or self-hosted runner ([0011](0011-interim-testflight-on-existing-team.md) keeps the Apple team).
