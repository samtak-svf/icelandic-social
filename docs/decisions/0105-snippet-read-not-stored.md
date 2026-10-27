# 0105. A notification's snippet is read with the list, never stored

- Status: accepted; designed, not yet implemented
- Date: 2026-10-27
- Decided by: Guðröður Atli Jónsson, approving the notifications v2 plan (#308)
- Builds on: [0067](0067-jobs-and-notifications.md) (rows carry ids only),
  [0008](0008-no-pii-in-logs.md)

## Decision

- **A page row carries `snippet`**, at most 100 graphemes: the newest comment's text for a
  comment or a reply, the post's text for a reaction, null for the other kinds.
- **It is read when the page is read**, from the post and comment the reader may still see: it
  is filled only when the reader passes the post's access check and the comment is visible,
  and is null otherwise.
- **Nothing new is stored.** No text enters `notifications` or `notification_actors`; 0067's
  rule that a notification row holds ids only still holds.

## Why

- A row that quotes what was said is the one the reader can judge without opening it.
- Reading it at list time means a removed comment, a block or a lost membership hides the text
  at once, with no copy to clean up.

## What it rules out

- Text in a notification row, a job payload or a push.
