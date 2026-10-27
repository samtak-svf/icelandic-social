# 0104. Seen is not read

- Status: accepted; implemented in the Worker, the core, the web and both apps (#308)
- Date: 2026-10-27
- Decided by: Guðröður Atli Jónsson, approving the notifications v2 plan (#308)
- Amends: [0067](0067-jobs-and-notifications.md) (marked read up to a time)

## Decision

- **Seen is per account, read is per row.** `notification_seen(account_id, seen_at)` records
  when the account last opened the list. Opening the list marks it seen, which clears the badge;
  it does not read any row.
- **A row is read when it is opened**, or marked read from its menu. It can be marked unread
  again. A header action marks every row read.
- **The page carries `seenAt`** (the value before this open) **and `unseen`** (unread rows newer
  than it). The badge counts `unseen`. `unread` stays for apps that predate this.
- **The list has two sections**: what came after `seenAt`, and the rest.
- **The row menu** marks the row read or unread, removes it (`DELETE /v1/notifications/{id}`),
  and sets its kind or its community to a lower level (0106).
- **API**: `POST /v1/notifications/seen {upTo}`; `POST /v1/notifications/read` takes `{upTo}`
  (every row, as before) or `{notificationId, read}` (one row).

## Why

- Marking everything read on open loses the one thing the list is for: which rows the reader
  has not looked at yet.

## What it rules out

- A badge that counts rows the reader has already seen in the list.
- Apps that predate this keep marking every row read on open; that stays valid.
