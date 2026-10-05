# 0011. Interim TestFlight builds on an existing Apple team, under their own ids

- Status: accepted
- Date: 2026-10-05
- Decided by: Guðröður
- Amends: 0010 (Apple only; the Play account is unchanged)

## Context

0010 puts the app on Samtak svf.'s own Apple team. Enrolling that team needs an Apple ID to
be its Account Holder, and an Apple ID can hold only one membership. The Apple ID that holds
the existing organisation team `B4724Z74TM` therefore cannot enroll Samtak svf., and
Apple's web form refused a new Apple ID for `samtak@samtak.is` on 2026-10-05 ("Your account
cannot be created at this time"). The first target is TestFlight for a closed test group
(0009), which does not need Samtak svf.'s own team.

## Decision

- **Until Samtak svf.'s team exists, TestFlight builds are signed on `B4724Z74TM`** with the
  team's existing Apple Distribution certificate and App Store Connect API key.
- **They carry interim ids that extend the frozen ones and never equal them:**
  `is.samtak.spjall.beta`, `is.samtak.spjall.beta.notifications` and
  `group.is.samtak.spjall.beta`. They live in `appleInterim` in `identifiers/ids.json`, and
  `tooling/ids-freeze.mjs` refuses an interim id that is a frozen id, an interim id that does
  not extend its frozen id, and an interim team that is the frozen team.
- **The frozen ids `is.samtak.spjall`, `is.samtak.spjall.notifications` and
  `group.is.samtak.spjall` are never registered on `B4724Z74TM`.** 0010's rule stands for them.
- **Only the `Interim` Xcode configuration signs**, through `ios-testflight.yml`, run by hand.
  Debug and Release stay unsigned until `services.appleTeamId` is set.
- **When Samtak svf.'s team is active,** `services.appleTeamId` gets its id, the frozen ids
  are registered there, and `appleInterim` becomes `null`, each by a lock edit citing this
  record.

## Why separate ids

Apple transfers an app between teams only if at least one version has been released on the
App Store. An app that has only been on TestFlight cannot move, so a frozen bundle id that
had a build uploaded on `B4724Z74TM` would stay there for good, and Samtak svf.'s team
would need a new id. An interim id costs one reinstall for the test group when the app
moves; the frozen id stays free.

## What the move orphans

Testers install the app under the frozen id as a new app. Device-local history (0006) and
the keychain do not follow it, and push tokens are issued again. That is acceptable for a
closed test group and is why this stays a TestFlight-only arrangement: nothing under the
interim ids goes to the App Store.

## Rules out

- Registering a frozen id on `B4724Z74TM`, as before.
- Submitting an interim build for App Store review.
- Signing the Debug or Release configuration with the interim team.
