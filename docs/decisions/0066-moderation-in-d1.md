# 0066. Reports and the moderation log are in D1; an action and its entry are one write

- Status: accepted; implemented in the backend (#31); amended by [0067](0067-jobs-and-notifications.md)
- Date: 2026-10-18
- Decided by: Guðröður Atli Jónsson (phase 4, #306)
- Builds on: [0063](0063-communities-audiences-and-moderation.md) (roles, reports, the log,
  retention), [0065](0065-the-space-object-and-social-media.md) (the `Space` object, `post_index`)
- Amends: 0063 (where reports and the log are kept, who reads a removed item, what is not
  built yet)

## Decision

- **Reports, the moderation log and Samtak's list of platform moderators are D1 tables**
  (`reports`, `moderation_log`, `platform_moderators`, migration 0016), owned by the
  `moderation` module. 0063 put reports and the log in the space's Durable Object; they move to
  D1 so that the platform's queue and log span every community in one query, and so that an
  action on a post, a member or a report is written in the **same D1 batch** as its log entry.
  The module that owns the row (`social` for `post_index`, `communities` for members and bans)
  takes the log entry as a statement and runs both in one batch. A comment lives in the space's
  object, so its entry is written first and the object changed after; an entry is never missing
  for a change that was made.
- **The log is append-only in the database as well as in the routes.** A trigger refuses any
  update but a deleted account's id becoming null, and any delete while the entry's community
  exists, so the entries go only with their community.
- **The actions** are `hide_post`, `remove_post`, `restore_post`, the same three for a comment,
  and `mute_member` (until a time), `unmute_member`, `remove_member`, `ban_member` and
  `unban_member`, each with a reason, optionally closing a report. **An action reaches only a
  lower rank**: a moderator acts on members, the owner on moderators and members, a platform
  moderator on anyone; nobody on their own content. The owner is never removed or banned.
- **Platform moderators** are rows in `platform_moderators`, added by the maintainer with
  `cf d1 execute`, never by a route. A platform moderator reads every community, private ones
  too, and its actions are logged with `as_platform`.
- **A report goes to one queue.** The platform's when the reporter asks for it, the reason is
  `unlawful`, or the target is a community or an account; the community's otherwise. An account
  reports a thing once while that report is open. A queue never shows the reporter. A report on
  the platform's queue is closed only by a platform moderator.
- **A hidden or removed item is gone for everyone but the community's moderators** and
  platform moderators, on every path (the feed, a list, a read, a comment count, a card, a
  reply). The community's moderators see it so they can restore it.
- **Retention**, as 0063 set it: the daily cron deletes a post removed 90 days ago, with its
  comments, reactions and images; the space's alarm does the same for a removed comment; the
  cron deletes a report a year after it was closed.

## Why

- A queue that spans communities cannot be read from one Durable Object per community without
  visiting every one.
- The log is the record that a moderator acted; an action whose entry could fail separately
  would leave a change without a record.

## What it rules out

- A route that edits or deletes a log entry, or that adds a platform moderator.
- A moderator acting on a peer, on someone above them, or on their own content.
- Telling a reported account who reported it.

## Not built yet

These parts of 0063 wait for their own work: the tombstone and the single review (the notice to
the author is [0067](0067-jobs-and-notifications.md)), locking a post's comments, a platform moderator
removing a community or suspending an account across the platform, and the platform's queue
for a community left with no moderator who can act.
