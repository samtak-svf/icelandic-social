# 0056. A read never waits for the network

- Status: accepted; implemented in the backend (6df9388) and the core (2fe45ec, core 0.23.0), released as 0.7.5;
  the start's reads moved in core 0.26.0, released as 0.8.6; a known push token starts no sync
  from core 0.27.0
- Date: 2026-10-15
- Decided by: the maintainer, approving the plan from the first speed baseline
- Builds on: [0022](0022-the-conversation-surfaces.md) (the socket that syncs on connect),
  [0001](0001-eu-storage-and-residency-wording.md) (where the data lives)

## Decision

- **The core reads through a read-only connection of its own.**
  - The list, a timeline, the history, the list's search on this device, the people and the
    settings are read on a second SQLite connection to the same store (`View`).
  - So are the two reads every start makes, who the device is signed in as and its token
    (core 0.26.0). On the S23 a sync that the push token started on each launch held the client
    for ~2.3 s, and `signed_in()` waited behind it with the screen blank. The `Spjall-Client`
    value is fixed when the client opens, so reading it takes no lock at all.
  - **A push token the server already has starts no sync** (core 0.27.0). The system hands the
    apps the same token on every launch; `set_push_token` says whether the server still lacks
    it, and only then do the apps sync. The socket's own sync on connect is the start's one.
  - `blocked()` and the directory's half of the list's search ask the server and store what it
    says, so they stay on the client.
  - That connection is opened with `query_only`, and it is behind its own lock.
  - A read never takes the lock that `sync()`, `on_frame()` or a send holds through their
    network calls, and in WAL it never waits for the writer.
- **A read does not write.**
  - An expired message is left out by the read's own query.
  - The purge that deletes it runs in `sync()` and `expire()`, which the apps already call.
  - `notices()` records what it has announced, so it stays a write.
- **The Worker runs next to D1.**
  - The Worker is placed in the cloud region next to D1's primary (`backend/cloudflare.config.ts`,
    `placement.region`), because every authenticated request makes two or more D1 round trips
    and D1 runs in EEUR. Smart Placement was on until 2026-10-21 and kept the low-traffic Worker
    at the edge (`cf-placement: local-KEF`, ~65 ms for each D1 query); `jurisdiction-check.mjs`
    now refuses a config without a region inside the EU.
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
