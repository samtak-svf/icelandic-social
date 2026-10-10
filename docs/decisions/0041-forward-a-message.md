# 0041. A message is forwarded as a fresh copy, marked "Áframsent", without its original sender

- Status: accepted; designed, not yet implemented
- Date: 2026-10-10
- Decided by: the maintainer, choosing it from a comparison with an established messenger
- Builds on: [0002](0002-mls-end-to-end-encryption.md), [0022](0022-the-conversation-surfaces.md)
  (the disappearing timer), [0023](0023-media-as-encrypted-blobs.md),
  [0024](0024-block.md), [0040](0040-share-a-post-into-a-conversation.md)
- Amends: 0009 (message actions: forward)

## Decision

- **A forward is a new message in the target conversation, sent by the forwarder**, with
  a copy of the original's content and one mark: `forwarded: true`, an optional field on
  `Body::Text`, `Body::Media` and `Body::Post` (0040) in `core/envelope/src/lib.rs`. The
  bubble shows "Áframsent" above the content.
  - Text is copied as it reads now: an edited message forwards its latest text, a reply
    forwards its own text without the quote, whose target is not in the new conversation.
  - **Media is re-encrypted and re-uploaded.** 0023 binds an object to one conversation's
    roster (`GET` answers `403 not_a_member` to anyone else), so the target's members could
    not fetch the original object. The core downloads and decrypts the original if it does
    not have it yet (`media`), then sends the file through `send_media`
    (`core/client/src/media.rs`), which seals it under a fresh key and uploads it into the
    target conversation. The original key never leaves its conversation, and the copy
    expires 30 days after its own upload.
  - A shared post (0040) is forwarded as the same `post` message: it carries only the id.
- **A field, not a new kind.** The envelope's compatibility rules (the top of
  `core/envelope/src/lib.rs`) say a client ignores fields it does not know but skips a kind
  it does not know. As a field, a forward reaches an older client as ordinary text or media
  without the mark; as a `forward` kind wrapping the body it would vanish there, while the
  sender believes it was delivered.
- **The original sender is not named**, in the envelope or on screen. Inside MLS a sender
  is authenticated only to the conversation they wrote in; a name copied into another
  conversation would be a claim the forwarder makes, which the recipients' cores cannot
  check, shown with the same weight as a verified author. It would also tell a new audience
  who wrote something to an audience the author chose. The forwarder can say in their own
  words where it came from.
- **A message with a disappearing timer cannot be forwarded.** The menu leaves "Áframsenda"
  out for an item with `expires_at` set (`Item` in `core/ffi/src/client.rs`; the core sets
  it from the conversation's timer when it stores a message, `insert` in
  `core/client/src/timeline.rs`), and the core refuses one. The people in that conversation
  agreed that its messages vanish; a copy would outlive the timer in a conversation that has
  a longer one or none, and the target's timer, not the source's, governs the copy.
- **What can be forwarded**: text, a reply, media and a shared post that the device has
  stored and that is not deleted. Not a tombstone, a timer card, a membership card, or a
  hidden message from a blocked account (0024).
- **The entry point is the message menu**: "Áframsenda" next to reply in the Android
  `Offer` and `Menu` (`android/app/src/main/kotlin/samtak/spjall/conversation/Bubble.kt`)
  and the iOS context menu (`ios/App/Conversation/Bubble.swift`). It opens the conversation
  picker; several conversations may be picked, and each gets its own copy (and its own
  upload, for media).

## Why

Forwarding is how a message reaches the people it concerns without retyping it. Copying the
content keeps end-to-end encryption whole: each conversation's members decrypt only what was
sent to them, under keys that never cross conversations. Leaving the author out is the safer
default because the alternative cannot be verified and exposes someone who did not choose
the new audience.

## Rules out

- A forward that names, links to or quotes the original sender or conversation.
- Reusing an original media object or key in another conversation.
- Forwarding a message under a disappearing timer, or copying the timer to the target.
- A count of how many times a message has been forwarded.
