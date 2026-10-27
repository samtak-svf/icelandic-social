# 0110. The apps wait for the caught-up marker before they call the list empty

- Status: accepted; implemented in the apps (#338)
- Date: 2026-10-27
- Decided by: Guðröður Atli Jónsson
- Amends: [0108](0108-the-socket-says-when-it-has-caught-up.md) (the apps, not only the web, wait for the
  marker)

## Decision

- **The core parses the marker into an event.** The Inbox socket's `{"type":"caught-up"}` frame
  becomes `Event::CaughtUp`, which Android and iOS receive through the same event stream as every
  other event.
- **The apps latch it on the socket, per sign-in, not per connection.** `Live.caughtUp` (Android) and
  `Live.caughtUp` (iOS) turn true when the event passes through the socket's event handling and stay
  true across reconnects. Each `start()` clears it, as it clears `signedOut`.
- **The conversation list reads it.** While the list is read, empty and not caught up, it shows
  `conversations_catching_up`; `conversations_empty` and its invite and find-people actions appear
  only once caught up. The placeholders before the first read and the rows of a non-empty list are
  unchanged.
- **The string is shared.** `conversations_catching_up` now has the surfaces `android`, `ios` and
  `web`.
- **Every exhaustive match over the core's events gets an arm for it that does nothing special.** The
  marker concerns no conversation.
- **The web keeps its own check in JavaScript** (0108): it has no core to emit an event.

## Why latched

The marker is sent once per opened socket, after the history the server owed. A list screen opened
after it passed (a tab switched to later, a screen recreated) would wait for a marker that never
comes again if the state lived in the screen or in a per-connection flag. Latching it on the socket
means any screen, whenever it opens, reads the state of the sign-in. Per sign-in rather than per
connection, because a reconnect owes nothing new to a device that is already caught up: the list must
not fall back to "catching up" every time the network blinks.

## What it rules out

- Telling a freshly linked device "no conversations yet" while its history is still arriving.
- A marker held inside a view model, which a later screen cannot see.
