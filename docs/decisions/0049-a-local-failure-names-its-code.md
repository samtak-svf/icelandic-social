# 0049. A failure no server answered names its code

- Status: accepted; implemented in the core (#230, core 0.21.0) and the apps, released as 0.7.2
- Date: 2026-10-15
- Decided by: the maintainer, after the 0.7.1 hand test stopped at an empty conversation list
  with no way to tell why
- Amends: [0037](0037-request-id-in-errors.md) (what a card shows when no server
  answered)
- Builds on: [0008](0008-no-pii-in-logs.md), [0016](0016-one-encrypted-store-owned-by-the-core.md)

## Decision

- **A failure the device made on its own shows a code under its message.** The card that shows
  a refusal's request id (`problem_request_id`, 0037) shows instead a small, selectable line
  naming the code (`problem_local_code`), so a tester can quote it.
- **The core makes the code, from a fixed vocabulary.** `CoreError::code()` gives the kind of
  failure, then what the core knows of it without quoting anything:
  - `store/<rusqlite's kind>`: for SQLite's own failure its result code and extended code
    (`store/ConstraintViolation/2067`), for a row that does not read the column index, name and
    type (`store/column-type/0/x/Text`), else a word (`store/no-rows`);
  - `protocol/<reason>` and `invalid/<reason>`: the core's own fixed sentence
    (`protocol/a stored media row`);
  - `mls/<refusal>`, with the step for one OpenMLS gave (`mls/openmls/merge`);
  - `envelope/<kind>`, `file/<io kind>`, `not-registered`, `unknown-conversation`,
    `sign-in`, `too-large`, `tampered`, `cannot-forward/<reason>`.
- **The code never carries a value, a name, a message text or SQL.** SQLite's and OpenMLS's own
  messages are dropped where the error crosses into the FFI, and the `detail` of a local
  failure is that code. A column or table name is the schema's, never a person's.
- **It is shown only.** The apps still write nothing to the system log, and nothing is sent
  anywhere. A refusal, an unreachable server and a client too old have no code: the first
  carries its request id, the others have nothing to quote.

## Why

The 0.7.1 list on the test phone failed on every open with the generic card, and the server
saw no failed request, so the failure was in the device's own store. Release builds log
nothing and the store is encrypted, so nothing on the card or in the logs said which of a
dozen reads failed. A code built from fixed words names the failure without opening the
store, and keeps 0008 by construction: there is nothing personal in it to leak.

## What it rules out

- Showing or logging an error's message text: SQLite's can quote SQL and the values in it.
- Sending local failures to a crash or error service.
