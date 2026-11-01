# 0123. One source for limits, counted in code points

- Status: accepted; implemented (#493)
- Date: 2026-11-01
- Decided by: Guðröður Atli Jónsson

## Decision

**`api/limits.json` is the only source of a limit or a window that a client and the server share.**
`tooling/limits-gen.mjs` writes it into the backend, the web, the core, Android and iOS, the files are
committed, and `check:limits` fails when one differs from what the source writes. A new shared limit
goes in that file, and no client writes its number. A window that belongs to a record comes from the
server instead: a deleted community's response carries `restorableUntil`.

**A text's length is its number of code points**, on every platform, because that is what the server's
validator counts. Each platform has one helper for it (`char-count.ts`, `text.rs`, `TextLimit.kt`,
`TextLimit.swift`), and `api/text-length.vectors.json`, which includes emoji and combining marks, is run
by the backend's validator and all four.

## Why

The clients had each copied the numbers, and three counted differently. Android and the web counted UTF-16
units and stopped a text of emoji at half its limit. iOS counted what the screen draws as one character, so
a text with combining marks passed on the phone and the server refused it. The core's directory query
counted UTF-16 as well. Copies had already drifted: iOS weighed a master photo against 10,000,000 bytes where
the server takes 10 MiB.

Code points were chosen because the server already counts them, so changing no server rule refuses no
stored text: a person's existing text passes an unrelated edit exactly as it did before.

## What it rules out

- A numeric limit in a client that the server also enforces, or a client-side copy of a server's window.
- `maxLength` on a web field (it counts UTF-16), and `String.length`, `String.count`, `utf16.count` or a
  plain `take`/`prefix` for a limit. A clip goes through the helper.

It does not cover what only a client decides: the zoom of a frame, where a long description folds, and the
core's margin below the server's limit on a group photo. Limits only the server enforces stay in the
backend.
