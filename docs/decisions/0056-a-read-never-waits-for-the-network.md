# 0056. A read never waits for the network

- Status: accepted; designed, not yet implemented
- Date: 2026-10-15
- Decided by: the maintainer, approving the plan from the first speed baseline
- Builds on: [0022](0022-the-conversation-surfaces.md) (the socket that syncs on connect),
  [0001](0001-eu-storage-and-residency-wording.md) (where the data lives)

## Decision

- **The core reads through a read-only connection of its own.**
  - The list, a timeline, the searches, the people, the settings and the blocked list are read
    on a second SQLite connection to the same store.
  - That connection is opened with `query_only`, and it is behind its own lock.
  - A read never takes the lock that `sync()`, `on_frame()` or a send holds through their
    network calls, and in WAL it never waits for the writer.
- **A read does not write.**
  - An expired message is left out by the read's own query.
  - The purge that deletes it runs in `sync()` and `expire()`, which the apps already call.
  - `notices()` records what it has announced, so it stays a write.
- **The Worker runs next to D1.**
  - Smart Placement is on (`backend/cloudflare.config.ts`), because every authenticated request
    makes two or more D1 round trips and D1 runs in EEUR.
  - Only where the code runs changes; no data moves.
  - The device-token lookup logs its duration (`auth.token_checked`), so the round trip each
    request pays can be read from Workers Logs.

## Why

The first speed baseline (S23, 0.7.3, 2026-10-15) shows four numbers:

| Measurement                 | Result            |
| --------------------------- | ----------------- |
| First frame                 | 199 ms            |
| Opening a conversation      | 330 ms            |
| Jank while scrolling        | 0.5 %             |
| The list after a cold start | 3.2 to over 3.9 s |

The list's wait is not its own:

- Every core call takes one lock, and the socket's first `sync()` holds it through a string of
  blocking HTTP requests.
- Each of those requests pays about 140 ms of D1 round trips before its handler, against 7 ms
  for `/health`.
- The list read also purged first, in a write transaction.

## What it rules out

- A read on the device that takes the client lock or the write lock.
- A list or timeline shown from a cache kept beside the store. The store is the one source, and
  the fix is to read it without waiting.
- Moving D1 or any other stateful resource out of the EU to make it closer.
