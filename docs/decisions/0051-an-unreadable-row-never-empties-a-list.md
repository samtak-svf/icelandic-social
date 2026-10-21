# 0051. An unreadable row never empties a list

- Status: accepted; implemented in the core (76a43ce, core 0.22.0) and the apps (17306bb), released as 0.7.4
- Date: 2026-10-15
- Decided by: the maintainer, choosing it from the follow-ups to 0050
- Builds on: [0049](0049-a-local-failure-names-its-code.md) (the code vocabulary),
  [0050](0050-a-store-gets-its-columns-whatever-its-history.md) (the store that failed whole)

## Decision

- **A stored row the core cannot decode becomes an item of its own, `Unreadable`, carrying its
  code.** Timeline rows (text marks, a file, a shared post, a members or timer card) and the
  messages this device still has queued are covered. The code is from the vocabulary of 0049
  (`protocol/a stored media row`, `envelope/malformed`) and never holds the row's content.
- **The item keeps its place.** It has the row's sequence number, times, sender, reactions and
  read markers, so paging, time lines and unread counts stay right.
- **The apps show one fixed sentence (`item_unreadable`) and the code under it**, in the
  conversation and as the list's last line. Nothing else can be done with the item.
- **A store failure still fails the call** and shows its `Villukóði` (0049). Only decoding is
  softened.
- **Every store a released core can leave behind is opened in a test.** A store built to each
  schema version (and to 0.18's variant of 14) must open to the same columns, indexes and
  triggers as a new store. `migrations-freeze` (0050) keeps the released migrations equal to
  today's, so this covers every store on a device.

## Why

`conversations()` reads the newest item of every conversation, so one undecodable row in any of
them returns an error, and the list and search show nothing. The person loses every conversation
over one message. 0050 was a schema fault, not a row, but it failed the same way, and only
a phone found it. A test over every released schema finds that class before release.

Store failures stay hard: a broken store made soft would show a list that silently misses
things, and the code is what found 0050.

## What it rules out

- Skipping an undecodable row silently, which would hide it from the person and from us.
- Turning a store error into an empty or partial list.
- Showing any part of an undecodable row's content.
