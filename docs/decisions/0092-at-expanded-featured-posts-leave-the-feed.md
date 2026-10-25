# 0092. On an expanded screen a featured post is shown in the aside only

- Status: accepted; implemented (#212)
- Date: 2026-10-25
- Decided by: Guðröður Atli Jónsson
- Amends: [0088](0088-a-community-features-several-posts.md) (the feed is complete on compact
  and medium only)
- Builds on: [0087](0087-wide-screens-get-their-own-layout.md) (the aside)

## Decision

0088 keeps the community feed chronological and complete: a featured post stays in its own
place in time, marked `Fest`, and is also shown in the strip. From this record that holds on
compact and medium screens only.

- **Expanded: the aside only.** When the community's featured posts are in the aside (the
  expanded layout of 0087), the community feed leaves out every post that is in the
  community's `featured` list. The rest of the feed keeps its order.
- **Compact and medium: unchanged.** The strip sits between the composer and the feed, and the
  feed stays complete, the featured posts marked `Fest` in their place.
- **The hub feed is unchanged.** `/v1/feed` and every other list keep each post where it is;
  only a community's own feed on an expanded screen leaves featured posts out.
- **The server is unchanged.** Width is a fact about the reader's screen, not the community,
  so the API still returns the complete feed and each client filters by its own layout, with
  one helper per platform that the tests hold.
- **Releasing a post puts it back.** A post that leaves `featured` reappears in its place in
  the feed with no reload of the feed.

## Why

On an expanded screen the aside and the feed are side by side, so a featured post shown in
both is the same card twice in one view (#206). On a narrow screen the strip is a short row
of cards the reader scrolls past, and the full post in its place in time is still the way to
read it; there the duplicate is not in view at once and the complete feed keeps 0079's
promise plainly.

## What it rules out

- Hiding featured posts from the feed on compact or medium screens.
- The server filtering the feed by a client's width, or a separate feed endpoint per layout.
- Leaving a post out of the hub feed or out of search because it is featured.
