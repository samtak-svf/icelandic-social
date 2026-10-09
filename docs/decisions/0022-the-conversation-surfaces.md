# 0022. The core folds every conversation into a timeline; the apps only draw it

- Status: accepted; implemented in the backend (#55), the core (#57, #58, #69) and both apps
  (#62 to #67)
- Date: 2026-10-07
- Decided by: the maintainer, approving the plan for the conversation UI after a review of it
- Builds on: [0006](0006-device-local-history.md) (single writer),
  [0009](0009-v1-scope.md) (the v1 surfaces and toggles),
  [0015](0015-delivery-protocol.md) (the socket frames, retention),
  [0018](0018-the-client-engine-in-the-core.md) (the outbox, typing),
  [0021](0021-group-info-and-external-join.md) (rejoining)
- Media is [0023](0023-media-as-encrypted-blobs.md); block is [0024](0024-block.md); push is
  [0025](0025-push-without-ids.md).

## Decision

0009 puts a conversation list, a conversation and "Ég" in v1. The core can send and receive
every envelope kind, but `history()` returns raw envelopes: an edit, a delete, a reaction and
a receipt are each their own row, and a `Conversation` is only its id and state. Two apps
folding that themselves would disagree. So the core folds once and the apps draw.

### The timeline

- **The core stores a folded timeline**, written in the transaction that decrypts the
  message (0006, single writer), in tables `timeline`, `reactions`, `read_state` and
  `members` (store migration 6). The app and its notification extension read the same rows;
  neither replays history.
- **`timeline(conversation, before, limit)` returns finished items**: text, media, reply-to
  preview, the edited flag, tombstones, reactions grouped with counts and whether one is
  the reader's own, read state, and system cards (new device, member added or removed, timer
  set or off).
- **An item's id is its `seq`, and items are ordered by `seq`.** The conversation's `seq` is
  unique and never reused, so it survives edits, reactions and expiry.
- **Unsent messages are items too.** An outbox row appears at the bottom as `pending`, in
  queue order, and as `failed` when the core gives up on it, with `retry()`. It takes its
  `seq` once the server answers.
- **`Event::Timeline` carries the changed seqs and `Event::Expired` the removed ones**, so
  an app inserts, updates and animates rows without querying a page again.
- **Every account the screens show comes with its name and mark resolved**: members,
  reactors, the actor of a system card. The apps never join account ids to names.
- **`conversations()` returns summaries**: members, title parts, the last item, the unread
  count, the timer and the state. A group has no name in v1; it is titled by its members.

### Names

- **`GET /v1/accounts/{accountId}` returns `{name, verified}`** to an account that shares a
  conversation with it, and `404 not_found` to any other. The name is the one Kenni verified,
  which is what the mark means, so a name a member types in-band would not do. The core caches
  profiles in the store.
- **`people()` returns the accounts met through shared conversations.** It is the only
  source of the new-conversation picker; 0009 has no search.

### The invite opens a 1:1

`GET /v1/invites/{token}` also returns the inviter's `accountId`; the token is already the
capability. `open_invite(token)` reuses an existing 1:1 with that account, or creates one and
adds the inviter.

### Read markers and typing

- **The toggles of 0009 are core settings.** Off stops both sending and showing, on both
  platforms alike.
- **`mark_read(conversation, seq)` is called when the newest item is on screen.** A receipt
  addresses an envelope id, which is unique per sender only, so the core maps the seq to its
  envelope id and sends one `Receipt` when the toggle is on and the mark moved forward.
  Unread counts come from `read_state`.
- **1:1 shows `read_marker` under the last own message the other person read; a group shows
  how many have read it** (`read_by_count`), counting accounts, not devices.
- **Typing in a 1:1 names the other person; typing in a group names no one.** A typing frame
  is sealed under an epoch key, so its sender is a claim (0018). In a 1:1 the only other
  member is known; in a group the row says that someone is typing. The core sends at most one
  typing frame per 3 s, and the app sends `typing` off before it goes to the background, so
  no row is left hanging on other devices.

### Disappearing messages

The timer is the conversation's, set by its last `Disappearing` envelope. The options are
off, 1 hour, 1 day, 7 days and 30 days; the duration keys in the strings file format them, so
both apps say the same. The core stamps `expires_at` on each row it stores, deletes expired
rows and their decrypted files on every call, and returns `Event::Expired`.

### Edit and delete

Edit and delete for everyone have no time limit; only the sender's own messages can be
changed, which the fold checks. An edit of an edit replaces the text again. A delete leaves a
tombstone and drops the reactions on it.

### The socket

The socket belongs to the app, as the transport does: OkHttp's WebSocket on Android, bound to
the process lifecycle, and `URLSessionWebSocketTask` on iOS, bound to the scene phase. It is
open in the foreground only, reconnects with jittered backoff, calls `sync()` on connect,
passes each frame to `on_frame` and sends the frames each `Outcome` returns. Its state feeds
the list's connection line (offline, connecting). Android may kill the socket in Doze without
closing it, so the app treats a missed `pong` as closed. Push is
[0025](0025-push-without-ids.md).

### What each screen shows

- **States.** `Removed` and `Excluded` are read-only with a banner and no composer. `Stale`
  shows a banner while the core rejoins (0021); nothing to tap.
- **Empty.** The empty list and the empty picker both point at the invite link and QR code.
- **History.** The `history_device_local_notice` shows once on a newly signed-in device; the
  "new device" card shows in each conversation, as 0006 says.
- **Grouping.** Consecutive messages from one sender less than 5 minutes apart are drawn as
  one group: one name, tighter spacing, one time.
- **Gestures.** Long press opens the message menu (reply, edit, delete for everyone, react),
  and the same actions are screen-reader custom actions. No swipe to reply in v1.
- **Reaction chips** sit under the bubble on the screen background: `fg` on `muted`, the
  reader's own on the gold chip pair.
- **Accessibility.** A bubble is one screen-reader element: sender, text, time, edited,
  reactions and read state. A verified name says so. Rows grow with the font scale (tested at
  200 %), touch targets are at least 48 dp / 44 pt, and the typing animation follows the
  reduce-motion setting.

### Where the apps differ on purpose

Dialogs (`AlertDialog`, `confirmationDialog`), the share sheet, back navigation (predictive
back, swipe back), the photo and file pickers, and file preview (`FileProvider`, QuickLook)
follow each platform. A parity review does not file these as bugs.

## Why

The rules for edits, deletes, reactions, receipts and expiry are easy to get slightly wrong,
and two hand-written folds would show different conversations to the two people in it.
Storing the fold where the plaintext is first written costs a few rows and means nothing ever
replays history. Ids that are `seq`s and events that name what changed are what a lazy list
needs to keep its scroll position and animate one row.

## Rules out

Folding envelopes in an app; an app joining account ids to names; a name taken from an
envelope instead of the server; a group typing row that names a sender it cannot prove; a
time limit on edit or delete invented by one app.
