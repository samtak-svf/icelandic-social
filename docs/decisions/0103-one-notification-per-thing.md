# 0103. One notification per thing acted on, with its actors

- Status: accepted; implemented in the Worker, the core, the web and both apps (#308)
- Date: 2026-10-27
- Decided by: Guðröður Atli Jónsson, approving the notifications v2 plan (#308)
- Amends: [0067](0067-jobs-and-notifications.md) (one notification per job key)
- Builds on: [0071](0071-comment-replies-and-reactions.md) (replies to a comment)

## Decision

- **A notification is one row per thing acted on**, not one per event. Comments on one's post
  are one row per post (`comment:<postId>:<accountId>`), replies to one's comment one row per
  parent comment (`reply:<parentCommentId>:<accountId>`), reactions to one's post one row per
  post (`reaction:<postId>:<accountId>`). An approved join request and a moderator's action stay
  one row per event.
- **`reply` is a kind of its own**: a reply to the reader's comment on someone else's post. It
  was sent as `comment` and read as a comment on the reader's post (0071).
- **Each event is a row in `notification_actors`**, keyed by its job key, with its actor, emoji,
  comment and time. The push is recorded on that row, so a job that runs twice still has one
  effect (0067).
- **A new event moves its group to now and makes it unread again.**
- **The API row carries `actors` (the newest three) and `actorCount`.** `actor`, `emoji` and
  `commentId` stay, holding the newest event's values, so an app that predates this still
  draws a sensible row.
- **Migration 0034 rebuilds `notifications`** with `reply` in its kind check, keeps every old
  column, re-keys the existing rows into groups and backfills their actors. A reply sent before
  it becomes `reply` under its own id: the parent comment is in the Durable Object, not in D1.

## Why

- One row per reacting account fills the list with the same post; the reader wants to know
  which post is busy and who is there.
- The reply text was wrong, and only a kind can fix it on every platform at once.

## What it rules out

- Grouping across posts or across kinds.
- Counting events instead of people: `actorCount` counts distinct actors.
