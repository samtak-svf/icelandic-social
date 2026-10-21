# 0067. Jobs are D1 rows written with their cause; notifications are rows for one account

- Status: accepted; implemented in the backend (#32)
- Date: 2026-10-18
- Decided by: Guðröður Atli Jónsson (phase 4, #306)
- Builds on: [0025](0025-push-without-ids.md) (a push names nothing),
  [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (no Cloudflare Queues, the `jobs/` module),
  [0063](0063-communities-audiences-and-moderation.md) (who is told what),
  [0066](0066-moderation-in-d1.md) (the moderation log)

## Decision

- **A job is a row in D1** (`jobs`, migration 0017), owned by the `jobs` module, with a unique
  key, a kind, a JSON payload, a state (`pending`, `done`, `failed`), its attempts and the time
  it may next run. It is written **in the same D1 batch as the change that causes it**: the
  comment's or reaction's author row, the approved member, the moderation log entry. A change
  without its job, or a job without its change in D1, cannot happen. Where the change itself is
  in a Durable Object (a comment), the job is written first and its handler checks the change
  is there before acting.
- **The same key is one job.** A second write of the key does nothing, so a retried request
  does not queue twice. A job that should exist only if the statement before it changed a row
  (an approved request) is written with `WHERE changes() > 0`.
- **A cron trigger every minute runs the jobs that are due**, 25 at a time. It leases each by
  moving its time forward five minutes and counting the attempt in one UPDATE, so a run that
  dies leaves the job to be taken again. A handler that throws is retried after
  1, 2, 4 and 8 minutes; after five attempts the job is `failed` for good, with the error's
  first 200 characters in its row and only the kind and the attempt count in the log
  (decision 0008). Finished jobs are deleted after 30 days.
- **Handlers are idempotent.** Running a job twice has one effect: the notice handler writes
  the notification under the job's key, and records that it pushed, so a second run neither
  writes a second row nor pushes again.
- **A notification is a row for one account** (`notifications`), owned by the `notifications`
  module: a comment on one's post, a reaction to one's post (one per reacting account, whatever
  it changes to), an approved join request, and a moderator hiding or removing one's post or
  comment. It is read in the app (`GET /v1/notifications`, unread count, a cursor) and marked
  read up to a time. It goes with the account and the community, its actor becomes null when
  the actor's account is deleted, and it is deleted after 90 days.
- **Whether to tell is decided when the job runs**, not when it is written: nobody is told of
  their own act, nothing is told across a block (except a moderator's action, which is never
  hidden from its subject), and a comment or reaction is told only while the recipient may
  still see the post and the comment. A job that finds nothing to tell is `done`.
- **The push is the chat push** (decision 0025): the same FCM message and APNs payload, which
  name no account, community, post or text. The app fetches the notifications when it wakes.

## Why

- 0060 rules out Cloudflare Queues, which have no jurisdiction; a D1 row is in the EU like the
  rest, and batching it with its cause gives "exactly once enqueued" without a second system.
- Deciding at run time keeps a block, a removal or a lost membership between the act and the
  cron from leaking anything.

## What it rules out

- A notification fanned out to every member of a community (0063: members read the feed).
- A push that carries an id, a name or any text.
- A job written outside the batch of its cause, or a handler with an effect that doubles when
  it runs twice.

## Not built yet

Mentions, follows, a notification for a reply to one's comment, per-kind push settings,
grouping several reactions into one notification, and the tombstone and single review of a
moderated item (0066).
