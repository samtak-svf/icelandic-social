# 0109. The socket says when it has caught up, and the web asks for the history until it comes

- Status: accepted; implemented in the Worker and the web (#326)
- Date: 2026-10-27
- Decided by: Guðröður Atli Jónsson, asking that a newly linked browser show progress (#326)
- Amends: [0015](0015-delivery-protocol.md) (what an opened socket is sent),
  [0064](0064-non-phone-devices-are-linked-devices.md) and
  [0074](0074-history-transfer-format-and-upload.md) (when the browser takes the history)

## Decision

- **The Inbox sends `{"type":"caught-up"}` after the `hello` and the backlog of `notify`
  frames** an opened socket is owed. Nothing is awaited between them, so no live frame comes
  before the marker. It is a frame of the `WsFrame` union (`CaughtUpFrame`); a core that does
  not know it ignores it, as it ignores every frame it does not know.
- **The web hands the marker to the core like any frame**, and once the worker has answered
  it, every frame before it has been handled: the worker answers in order (0081). Only then is
  the backlog caught up.
- **The chat session owns the phone's history.** Each time a chat starts ready, it asks the
  core for the history first. The core answers 0 at once when none is owed. While the phone is
  still uploading (`refused`/`not_found`) or the network is away, it asks again, waiting
  2, 4, 8 and 16 seconds and then half a minute, about ten minutes in all. Any other failure
  ends the asking; the link holds either way. The link page no longer asks once and forgets.
- **A ready chat reports what it still waits on**: `history`, then `backlog`, then `done`.
  The conversation list shows "Sæki eldri skilaboð…" while the history is owed and
  "Sæki samtölin þín…" while the backlog is, reads the store again when the chat catches up,
  and says there are no conversations only of a list read after that.

## Why

- A newly linked browser showed "no conversations" for about ten seconds and then all of them
  at once. The core joins each conversation it is told about by a backlog `notify` (a Welcome,
  an MLS join, the message pages, profiles and photos, each a blocking request), and the
  worker answers one call at a time, so the page's own reads of the list waited behind the
  whole backlog. Nothing told the page that the list it read was not yet the whole list.
- An end-to-end marker is exact where a timer guesses: it says the core has handled what the
  server owed the socket, however long that takes.
- The phone approves the link before it uploads the history, and the server answers
  `not_found` until the upload completes. The browser asked once, right after the approval,
  and dropped the failure, so a browser that asked before the upload finished never received
  the older messages. The core keeps the one-time key on such a failure precisely so the call
  can be made again.

## Rules out

- A timer or a fixed delay standing in for "caught up".
- Saying "no conversations" of a store that has not yet received what the server owed it.
- Asking for a linked history once and giving up on the first failure.
