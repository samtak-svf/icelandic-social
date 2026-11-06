# 0131. No deploy without a test before it

- Status: accepted; implemented (#593)
- Date: 2026-11-06
- Decided by: the overseer, on Guðröður Atli Jónsson's standing rule that a merge never ships untested; his to overturn
- Amends: [0128](0128-every-apps-release-goes-to-testers.md)

## Decision

**Every job that deploys or uploads a release runs a test step before its first deploy step, in the
same job.** `deploy.yml` and `staging.yml` run the backend `check` and `test`. `android-play.yml`
runs the Gradle `check` task and the unit-test-count check `android.yml` runs, and
`ios-testflight.yml` runs `ios/scripts/test.sh`, the script `ios.yml` runs. In both release
workflows the test comes before the signing material is written.

## Why

`staging.yml` deployed on every push to `main`, and the release workflows that
[0128](0128-every-apps-release-goes-to-testers.md) started on a version bump signed and uploaded a
build that only the path-filtered PR workflows had tested. A job that tests its own commit does not
depend on a sibling workflow having run.

## Rules out

- Making `apps-release.yml` wait on `android.yml` or `ios.yml` as reusable workflows: their
  concurrency groups would collide with the push-triggered run on the same commit.
- A test step that runs after the first deploy step, or in another job.
