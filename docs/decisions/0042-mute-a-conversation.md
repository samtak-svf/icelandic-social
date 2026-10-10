# 0042. Muting a conversation is server state in the account's Inbox, checked before a push

- Status: accepted; implemented in the backend (#169), the core (#172) and the apps (#180)
- Date: 2026-10-10
- Decided by: the maintainer, choosing it from a comparison with an established messenger
- Builds on: [0008](0008-no-pii-in-logs.md), [0015](0015-delivery-protocol.md),
  [0017](0017-conversations-on-the-server.md), [0022](0022-the-conversation-surfaces.md)
- Amends: 0009 (messaging: mute), 0025 (muting per conversation was ruled out of v1)

## Decision

- **A mute is one row per account and conversation in the account's `Inbox`**
  (`backend/src/do/inbox.ts`): a `mutes` table of `conversation_id` and `until`, Unix
  milliseconds, null for "until turned back on". Ids and a time only (0008); the Inbox
  already holds one row per conversation the account is in, so a mute adds nothing new
  about the account's social graph. Deleting the account wipes it with the rest of the
  Inbox (`wipe`).
- **It is checked before a push is owed.** In `Inbox.notify`, the loop that writes
  `push_outbox` rows for devices with no open socket skips a conversation whose mute is in
  force, so no push is sent and no device wakes. Muting also deletes that conversation's
  unsent outbox rows. Open sockets still get `notify`, and the message is stored and synced
  as before; only the push is withheld. A mute whose `until` has passed counts as none and
  is deleted at the next write.
- **The core also knows it, and `notices()` leaves muted conversations out.** A push for
  another conversation runs `sync()` and `notices()` (0025), which would otherwise show the
  muted conversation's messages too. Their notices are recorded as shown, so they do not
  appear when the mute ends.
- **Durations: 1 hour, 8 hours, or until turned back on.**
  `PUT /v1/conversations/{conversationId}/mute` takes `{"for":"1h"|"8h"|"always"}`, and the
  server sets `until` by its own clock, so a device with a wrong clock cannot mute for the
  wrong time. `DELETE` on the same path unmutes. Both answer only to a member, like media
  (`403 not_a_member`).
- **It follows the account, not the device.** `GET /v1/mutes` lists the account's mutes,
  read by the core at each sync, and a change sends a new `mute` frame
  (`{conversationId, muted, until?}`, `until` absent while unmuted or muted until turned back
  on) to the account's open sockets, so every device shows the same
  state at once. The frame is added in `backend/src/api/frames.ts` and generated into
  `WsFrame.kt` (0005).
- **What the screens show.** The unread count still rises: a mute silences, it does not hide.
  The conversation list row shows a muted mark next to the time and draws the unread badge
  in the muted colour instead of the primary one (the row's `unread` styling in
  `android/app/src/main/kotlin/samtak/spjall/conversations/ConversationsScreen.kt` and
  `ios/App/Conversations/ConversationsView.swift`). The conversation's menu offers "Þagga"
  with the three durations, and "Kveikja á tilkynningum" while muted. `Conversation` in
  `core/ffi/src/client.rs` gains `mute`: `Off`, `Until { at }` or `Always`.

## Why

A mute only the device knows still lets the server push, and the push wakes the device. On
iOS every push must show an alert (0025), and the extension cannot reliably drop one without
Apple's filtering entitlement, so a client-side mute would still show `push_fallback_body`
for a muted group. The server is the only place that can decide not to wake a device, and the
Inbox is where that decision is already made, per device and conversation. Keeping it there
also syncs the mute across the account's devices for free.

## Rules out

- A mute per device, or one only the app knows.
- Exceptions by keyword or by sender, which would need the server or the push to read
  content.
- Hiding a muted conversation's unread count, or archiving it.
- A name, a duration chosen as free text, or anything but ids and a time in the mute row or
  a log line.
