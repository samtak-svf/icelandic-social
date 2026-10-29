# 0112. The tester guide is a public page of the web app

- Status: accepted; implemented (#350)
- Date: 2026-10-29
- Decided by: Guðröður Atli Jónsson

## Decision

- **The guide to joining the test lives in the web app's signed-out pages**, at `/testers`, served
  by the same Worker as `/privacy` and `/support` and readable without signing in. The web sign-in
  screen links to it. It is the one link a would-be tester is sent (decision 0084).
- **Its text is brand strings**, whole sentences in `brand/<name>/strings.is.json` with the
  surface `web`, so a brand rename carries the guide with it.
- **It walks both platforms in order**: the email that asks to join, then on Android the Play test
  link, the opt-in page and the store listing marked unreviewed, and on iPhone the App Store Connect
  invitation, TestFlight and its invitation. It says why the stores mark the app unreviewed: builds
  reach testers before store review, and the label goes at the open beta.

## Why

A new tester meets store screens that say the app is unreviewed, with nothing to explain them, and
may stop there. The web app is where testers already sign in, and its strings are the brand's, so
the guide needs no second site and no second copy of the text.

## What it rules out

- The guide as a `docs/` page or a page on the brand site.
- Screenshots of the store screens with a real person's account, names or contacts in frame. Images
  added later are taken with a test account.
