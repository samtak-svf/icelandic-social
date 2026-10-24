# 0088. A community features up to three posts, shown as a strip

- Status: accepted; designed, not yet implemented
- Date: 2026-10-24
- Decided by: Guðröður Atli Jónsson
- Amends: [0080](0080-communities-follow-the-familiar-group-layout.md) (pinning: up to three
  posts instead of one, shown as a strip instead of leading the feed),
  [0009](0009-v1-scope.md) (featured posts are in v1)
- Builds on: [0066](0066-moderation-in-d1.md) (every pin is a log entry),
  [0087](0087-wide-screens-get-their-own-layout.md) (the aside)

## Decision

0080 lets the owner or a moderator pin one post to the top of the feed. From this record a
community **features up to three posts**, and they are shown apart from the feed.

- **`Festa` and `Losa` stay the only controls**, in the post's `⋯` menu, for the owner and the
  moderators. Pinning a fourth post is refused with a message saying three are featured and
  one must be released first; the moderator chooses which, nothing is released silently.
- **The strip.** On an expanded screen the featured posts sit in the community's aside
  ([0087](0087-wide-screens-get-their-own-layout.md)) under `Fest`; on compact and medium they
  are a horizontally scrolling row of cards between the composer and the feed. A card shows
  the post's first image (or the author's picture), the first lines of the body and the
  author, and opens the post screen. A community with no featured post shows no strip.
- **Newest pin first.** The strip is ordered by when each post was pinned; there is no manual
  reordering.
- **The feed stays chronological and complete.** A featured post no longer leads the feed; it
  stays in its own place in time, marked `Fest` as today, so the feed is newest-first with no
  exception (the one exception 0080 allowed is removed).
- **A featured post is read through its own access check.** A removed or deleted post leaves
  the strip with it; a private community's strip is shown only to readers the community admits.
- Every pin and release is an entry in the moderation log, as 0080 has it.

How it is stored: the Space object's `pinned_post` table (at most one row) becomes
`pinned_posts` keyed by the post, with the pin time, and the space refuses a fourth row. The
existing pin migrates as the first featured post. The community response carries the featured
posts as `Post` values, so no client asks for them separately.

## Why

The desktop comparison of 2026-10-24 (kept privately under 0073) showed featured posts as a
strip of several cards beside the composer, and the community's rules, a welcome post and a
current notice are three different things a moderator wants kept in view at once. One pin
forces them to choose. Three keeps the strip a glance rather than a second feed, and a fixed
limit that refuses rather than evicts keeps every change a moderator's own logged act.

Taking the pinned post out of the feed's lead keeps 0079's promise plainly: the feed is
newest first, and what moderators choose to keep in view is labelled as their choice, in its
own place.

## What it rules out

- More than three featured posts, or a limit a community sets for itself.
- A post featured by any rule other than a moderator's `Festa` (by reactions, by age, by
  an algorithm).
- A featured post shown to a reader its access check would refuse.
- A pin or release that is not in the moderation log.
