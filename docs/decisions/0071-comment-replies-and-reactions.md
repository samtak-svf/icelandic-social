# 0071. Comments take one level of replies and no reactions

- Status: accepted; implemented (#80)
- Date: 2026-10-20
- Decided by: Guðröður Atli Jónsson
- Builds on: [0063](0063-communities-audiences-and-moderation.md) (communities, comments and
  moderation), [0065](0065-the-space-object-and-social-media.md) (the `Space` object),
  [0067](0067-jobs-and-notifications.md) (notifications)
- Amends: [0009](0009-v1-scope.md) (v1 scope), [0063](0063-communities-audiences-and-moderation.md)
  (comments on a post)
- Closes: #371

## Decision

### One level of replies to comments

- **A comment may reply to a top-level comment on the same post.** In the community's `Space`
  Durable Object ([0065](0065-the-space-object-and-social-media.md)), `comments` carries an
  optional `parent_comment_id`. A comment with `parent_comment_id = NULL` is a top-level
  comment on the post; a comment with `parent_comment_id` set is a reply shown indented one
  level under that top-level comment, in chronological order.
- **There is only one level of indentation.** Replying to a reply attaches to the same
  top-level `parent_comment_id` (or the API refuses a `parent_comment_id` that is itself a
  reply or belongs to another post). Threads never nest deeper than one level.
- **Replying notifies the parent comment's author** ([0067](0067-jobs-and-notifications.md)):
  when the replier is not the parent comment's author and neither account has blocked the
  other ([0024](0024-block.md)), the `Space` object's return causes the Worker to queue a
  notification for the parent comment's author, alongside the post author's comment
  notification (deduplicated when the post author and parent comment author are the same
  account).
- **A hidden, removed or author-deleted parent with visible replies leaves a tombstone line.**
  When a top-level comment has no visible replies, hiding, removing or deleting it omits it
  from ordinary readers' lists as [0065](0065-the-space-object-and-social-media.md) and
  [0066](0066-moderation-in-d1.md) already do. When it still has visible replies, the list
  keeps a minimal tombstone placeholder in its slot (carrying `commentId` and `createdAt`, with
  no author or body for ordinary readers) so the replies underneath keep their place; moderators
  still see the hidden or removed parent with its standing.
- **Moderation needs no new action.** A reply is a comment in `comments`, reported and
  moderated with the existing `hide_comment`, `remove_comment` and `restore_comment` actions
  ([0066](0066-moderation-in-d1.md), [0070](0070-community-deletion-and-declined-requests.md)).

### No reactions on comments

- **Comments do not take reactions.** Only posts take the five reactions of
  [0063](0063-communities-audiences-and-moderation.md) (`👍 ❤️ 😂 😮 😢`). Leaving reactions off
  comments is deliberate: a comment thread is for written replies, not reaction counts.

## Why

- On a post with many comments, a single flat list loses which earlier remark a new comment
  is answering. One level of replies restores that context without turning phone screens into
  narrow staircases of nested indentation.
- Keeping a tombstone when a parent comment has replies prevents a moderator action or author
  deletion on one comment from silently hiding or orphaning other people's replies below it.
- During closed-beta testing (#371), the tester who asked about comment reactions noted that
  omitting them may itself be a feature because the written argument matters more than like
  counts. Keeping reactions on posts only preserves that focus and avoids a second reaction
  surface and notification stream.

## Rules out

- Multi-level nested comment trees (replies to replies indenting past level one).
- Reactions on comments, or reaction counts/notifications on comments.
- Storing comment replies in D1 (they live in the `Space` Durable Object's `comments` table,
  per [0065](0065-the-space-object-and-social-media.md)).
