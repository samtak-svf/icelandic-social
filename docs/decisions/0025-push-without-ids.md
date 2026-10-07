# 0025. A push says only "sync"; the device decides what to show

- Status: accepted; designed, not yet implemented
- Date: 2026-10-07
- Decided by: the maintainer, approving the plan for push notifications
- Amends: [0002](0002-mls-end-to-end-encryption.md) (the fetch hint),
  [0015](0015-delivery-protocol.md) (when a push is sent),
  [0017](0017-conversations-on-the-server.md) (the push outbox)

## Decision

### What a push carries

- **Nothing that names a conversation or a message.** An FCM message is data-only, high
  priority, with an empty data map apart from a version field. An APNs push is an `alert`
  with `push_fallback_body`, `mutable-content: 1` and no custom keys. 0002's fetch hint
  `{conv, seq}` is dropped.
- **A woken device runs the same `sync()` the app runs when it opens.** The core fetches
  every conversation that is behind, decrypts, and stores, as it does in the foreground.

### When a push is sent

- **A message is urgent or not, and only an urgent one pushes.** `SendMessage` gets an
  `urgent` flag, `true` when it is left out. The core sets it to `false` for receipts,
  reactions, edits, deletes and commits. Text and media are urgent.
- **A message is never urgent for its sender's own account.** The sender's other devices
  still get `notify` on an open socket and catch up at their next sync, but no push.
- **One push per device, re-armed by each newer urgent message.** The `Inbox` keeps one
  outbox row per device and conversation, as now, but a newer urgent `seq` sets the row back
  to unsent. Each round of `push()` sends at most one push to a device, however many of its
  rows are unsent, and marks them all sent. `ack` deletes the rows it covers, as now.
- **A failed send is retried by the `Inbox` alarm**, as now. A token the provider calls dead
  (FCM `UNREGISTERED` or 404, APNs 410 or `BadDeviceToken`) is cleared and not retried.

### Tokens

- **A device registers its own token** with `PUT /v1/devices/{deviceId}/push`
  `{token, sandbox}` and removes it with `DELETE` on the same path. Only that device's own
  device token may do either. `sandbox` is for APNs development builds and is ignored on
  Android.
- **D1 `devices` gets `push_token` and `push_sandbox`** (migration 0006). A token is unique
  across devices, so registering it on a new device clears it from the old one. Revoking a
  device clears its token; deleting the account deletes the row (0019).
- **The core keeps the token** (`set_push_token`) and sends it on the next sync until the
  server has it, so a token issued while offline still arrives. The apps pass every token
  the platform gives them; the core skips one it already sent.

### Senders

- **The Worker talks to FCM HTTP v1 and APNs directly, with no SDK.** FCM uses an OAuth token
  from a service-account JWT (RS256); APNs uses a provider JWT (ES256). Both are signed with
  WebCrypto and cached in the isolate until shortly before they expire.
- **With no credentials configured, the sender only logs** `push.skipped`, as now. Local
  development, the tests and the core's interop run that way.
- **The push token is never logged** (0008).

### What the device shows

- **The core decides, so both platforms show the same.** `notices()` returns the items to
  show and the conversations to clear:
  - **Shown:** each new text or media item from another account since the last call, with
    the conversation's title, the sender's name and mark, and the text or "Mynd"/"Skrá".
    Not an item from a blocked account (0024), not one already expired, and not one in a
    conversation that is read up to it.
  - **Cleared:** conversations that had notices and are now read, on this device or as the
    core learns from the account's other devices.
  - A store table keeps what was shown, so the app and the extension never show an item
    twice.
- **Android:** the messaging service runs `sync()` and `notices()` and posts one
  `MessagingStyle` notification per conversation on the messages channel. A tap opens the
  conversation. If the sync fails, it posts `push_fallback_body`.
- **iOS:** the notification service extension runs `sync()` and `notices()` within its time
  limit and rewrites the alert: the title and body from the notice, and the conversation as
  the thread. If it runs out of time, the alert keeps `push_fallback_body`. A tap opens the
  conversation.
- **The app asks for permission to notify after sign-in**, once. When it is refused, "Ég"
  shows a row that opens the system settings.

## Why

An id in the push would let Google and Apple see which devices receive the same
conversation at the same moments, which is the social graph that end-to-end encryption
keeps from the server. A push with no ids leaks only that some device got something. The
cost is a sync of every conversation that is behind instead of one, and that is the call
the app already makes on every open.

Without the urgent flag, every read receipt and reaction would wake every member's
devices, and on iOS each push must show an alert, so a receipt would show "Ný skilaboð".
The flag tells the server which messages to push for. The server could already guess most of
that from size and timing. The flag is the sender's claim, and a sender that lies only
pushes its own peers too often.

Today's outbox sends one push per row and then waits for an `ack`, which only an open socket
sends. A device that stays in the background never acks, so it would get one push and no
more. Re-arming on each newer urgent message fixes that, and one push per device per round
keeps a burst across several conversations to a single wake.

Putting the choice in the core keeps the block, expiry and read rules in one place, tested
once, and the Android service and the iOS extension stay thin.

## Rules out

Message content, a conversation id, a sender or a count in a push payload; the server
deciding urgency by reading anything inside the ciphertext; a push for one's own messages;
notification SDKs in the Worker; muting per conversation, replying from a notification and
a preview-off setting in v1 (the lock-screen settings of each OS cover previews).

## Known limits

- **Google and Apple process push outside the EU.** They see a device token, the time and
  the payload size, never content or ids (0001 keeps stored data in the EU; nothing is
  stored with them).
- **iOS may show the fallback text when there is nothing new to show,** for example when the
  app was opened in the meantime or the message is from a blocked account. The extension
  then delivers empty content, which iOS does not display today. Dropping a notification
  for sure needs Apple's filtering entitlement, which v1 does not ask for.
- **Android lowers a high-priority FCM message's priority** for an app that often shows
  nothing after one. The urgent flag keeps those cases rare.
- **The APNs key belongs to an Apple team.** It is made on Samtak svf.'s own team (0010).
  Until that team exists, iOS push works only if the maintainer amends 0011 to allow a key
  on the interim team.
