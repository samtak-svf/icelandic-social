# 0107. The device announces social notifications

- Status: accepted; implemented in the Worker, the core, the web and both apps (#308)
- Date: 2026-10-27
- Decided by: Guðröður Atli Jónsson, approving the notifications v2 plan (#308)
- Amends: [0025](0025-push-without-ids.md) (the device announces only chat),
  [0067](0067-jobs-and-notifications.md)

## Decision

- **The push still names nothing** (0025). After the sync a push causes, the core reads the
  first notifications page and returns, besides the chat notices, the rows that are unread,
  have `announce` (0106), and are newer than the last announcement of the same row.
- **The core remembers each notification id and the time it last announced it**, in its store,
  so a group that gains an actor is announced again and a re-run is not.
- **The apps write the sentence** with the same formatter as the list row, so a notification and
  its row say the same thing.
- **Android posts them on a channel of their own**; iOS shows them from the notification
  service extension. A tap opens the post, or the community when there is none to open.
- **Reading a row clears its notification**, as reading a conversation clears a chat notice.

## Why

- A comment on one's post reached the list but never the lock screen.

## What it rules out

- A push that carries the notification's text or ids.
