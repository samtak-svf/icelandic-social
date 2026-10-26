# 0099. What this device did shows at once

- Status: accepted; implemented (#272)
- Date: 2026-10-26
- Decided by: Guðröður Atli Jónsson
- Amends: [0022](0022-the-conversation-surfaces.md) (the reader showed only a new message while
  it waited; "edits, deletes, reactions and receipts show once they are back")

## Decision

- **The reader overlays what this device has queued.** When the core reads the items of a
  conversation, it applies the outbox's unsent `message` envelopes of this device onto them, in
  outbox order: an own reaction added or taken back, an edit (the new text, `edited` set), and a
  delete for everyone (the tombstone the stored path makes). The device that acted sees the
  change from its own store, with no request. Each step is applied as the fold applies it and
  is idempotent, so an echo folded while the row is still queued, or after it is gone, leaves
  the same item: nothing is counted twice. A target that is deleted or not among the items
  changes nothing. Receipts still show once they are back.
- **After a send the apps sync only that conversation.** The core gains
  `sync_conversation(conversation)`, which sends that conversation's queue, fetches what is new
  there and purges what a timer ended, and makes no request for any other conversation, key
  packages, profiles, blocks or mutes. The ffi and wasm surfaces expose it beside `sync`. An
  app's send is: `send`, load (the overlay shows the change), `sync_conversation`, load. The
  socket's full sync and an app's refresh keep `sync`.
- **The send path logs durations only** (0008): how long the local write and the targeted sync
  took, as numbers, never an id, a text or an emoji.

## Why

A reaction took 4 to 7 seconds to appear, measured on a phone: the app waited for the full
`sync`, which walks every conversation in turn before the one on screen, and the pending reader
skipped a queued reaction. The time depended on where the chat sat in the list, not on the
reaction.

## What it rules out

- **An app-side optimistic copy.** The core's store is the one truth the apps draw (0022);
  two apps keeping their own provisional state would disagree, and the overlay gives both the
  same answer.
- **Waiting for the echo** before showing what this device did.
