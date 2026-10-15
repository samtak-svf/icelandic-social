# 0050. A store gets its columns whatever its history

- Status: accepted; implemented in the core (#232, core 0.21.1), released as 0.7.3
- Date: 2026-10-15
- Decided by: the maintainer, after 0.7.2 showed `store/sql-input` on the conversation list of a
  phone upgraded from 0.6
- Builds on: [0016](0016-one-encrypted-store-owned-by-the-core.md) (the core owns the store and
  its migrations), [0048](0048-server-time-lines-attachment-preview-and-photo-location.md) (the
  timeline's `received_at`), [0049](0049-a-local-failure-names-its-code.md) (the code that named
  it)

## Decision

- **After its migrations, `Store::open` adds any listed column the store lacks** (`REPAIRS` in
  `core/store/src/lib.rs`), in one transaction. Today the list is the timeline's `received_at`,
  the outbox's `refused` and the conversation's `join_refused_at`.
- **The client code dropped by mistake comes back**: a refused message row is set aside until
  retry, and a refused join waits an hour (#186), as released in core 0.18.
- **A migration that has been released is never edited, removed or renumbered.** A test compares
  `MIGRATIONS` with the migrations of every released `core-v*` tag.

## Why

Store version 14 means two things on devices. Core 0.18 (#186) stored `outbox.refused` and
`conversations.join_refused_at` under it. An unrelated apps change (#192) then removed that
migration and the code using it, by a bad rebase, and core 0.20 (0048) stored
`timeline.received_at` under the same number. A store that ran 0.18's 14 skips 0.20's, so every
read of the timeline fails to prepare: the conversation list and search are empty with an error,
and stay so. A store that ran 0.20's 14 lacks the columns #186 needs.

No migration 15 can fix both, because each history has a column the other lacks, and adding a
column twice fails. Checking the columns that exist is the only test that is true for both.

## What it rules out

- Telling the two histories apart by version number, or renumbering 14.
- Asking a user to clear the app's data or sign in again to recover: the repair runs on open
  and keeps everything stored.
