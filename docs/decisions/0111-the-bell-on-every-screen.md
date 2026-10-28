# 0111. The bell is in the top bar of every screen

- Status: accepted; implemented (#345)
- Date: 2026-10-28
- Decided by: Guðröður Atli Jónsson
- Amends: [0109](0109-notifications-bell-in-top-bar.md) (the bell is on every full screen of the signed-in
  app, pushed screens included, not only in each place's own header)

## Decision

- **The bell, with its unseen count, ends the top bar of every full screen** of the signed-in app on
  Android, iOS and the web: a conversation, its information, a post, a community, the people picker, link
  scan, the report, join-request and anonymous queues, and any other screen that has a way back.
- **It sits at the trailing end, after that screen's own actions.** Tapping it opens the notifications, and
  the way back returns to where the reader came from.
- **A modal sheet draws none.** A sheet with a cancel or confirm toolbar, or a bottom sheet, is a step
  inside another screen, not a screen of its own.
- **The sign-in steps draw none either.** The Kenni offer after a sign-in is a step of the sign-in.
- **The web is unchanged.** Its shell already draws the bell on every route.

## Why

A conversation is where a reader spends most of the time, and it is the one place the count was out of
reach under 0109: a tester looked for it there and found a way back and nothing else. The notifications
are about everything the reader follows, so the count belongs on every screen the reader can be on,
not only on the three the tab bar names.

## What it rules out

- A bell in a modal sheet, where it would open a screen above the one the reader is in the middle of.
- A second count, or a different place for the bell on some screens.
