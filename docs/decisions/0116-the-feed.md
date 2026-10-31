# 0116. The feed: a first tab, newest first, read per source

- Status: accepted; implemented on the server (`GET /v1/home`, with snooze and block in the statement). Still to come: the measurement below, the tab, the composer and the card on the web and in the apps
- Date: 2026-10-30
- Decided by: Guðröður Atli Jónsson
- Amended by: [0117](0117-names-in-the-ui-are-one-table.md) (the `Samfélög` tab is `Hópar`)
- Amends: [0044](0044-no-fljotid-in-v1.md) (two tabs, "no other tab"),
  [0009](0009-v1-scope.md) (the surfaces),
  [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (no feed in the apps until after the open beta; the release order),
  [0080](0080-communities-follow-the-familiar-group-layout.md) (the post card)
- Builds on: [0114](0114-friends-and-the-person-screen.md), [0115](0115-the-wall.md),
  [0034](0034-fljotid-and-the-wall.md) (the word), [0079](0079-community-layout-feed-and-management.md),
  [0087](0087-wide-screens-get-their-own-layout.md), [0092](0092-at-expanded-featured-posts-leave-the-feed.md),
  [0109](0109-notifications-bell-in-top-bar.md), [0113](0113-a-hosted-call-never-waits-for-a-sync.md),
  [`docs/d1-social-workload.md`](../d1-social-workload.md)

## Decision

### The tab

- **The feed is the first tab and what opens**, at `/` on the web, with Ég moving to `/me`. After it each platform
  keeps its order: on the web Ég, Samfélög, Hjal, Stillingar (`web/src/ui/shell.tsx:96–107`); in the apps Hjal,
  Samfélög, Ég (`android/app/src/main/kotlin/samtak/spjall/MainActivity.kt:338–344`,
  `ios/App/Home/HomeView.swift:200–202`). **That is five tabs on the web and four in the apps.**
- **The label is "Fljótið"**, in the key `tab_feed`, the owner's word from 0034. It is the definite form of `fljót`,
  which BÍN has. "Straumur" is no less a metaphor and "Heim" says where, not what, so neither is better.
- **They fit by construction, and the fit is an acceptance check.** The web's items take an equal share with
  `text-xs` and `overflow-wrap` (`web/src/ui/shell.tsx:139–160`), so 360 px gives each 72 px. Android
  (`android/app/src/main/kotlin/samtak/spjall/ui/Tab.kt:58–80`) and iOS (`ios/App/UI/TabBar.swift:35`, `:40`) share out
  width and scale their labels. Each platform is checked at 320 and 360 px in the PR that adds the tab. At medium the
  rail is unchanged (`AdaptiveNavigation.kt:33–70`, `medium:w-24` in `shell.tsx`).

### What it reads

- **Newest first. No ranking, no fan-out, no suggestions** (0060).
- **Three sources:** the account's communities, its friends' wall posts it may read, its own wall.
- **`GET /v1/home` is new, and `/v1/feed` stays exactly as it is** (`feed` in `backend/src/modules/social/posts.ts`), community
  only, so an installed app is not affected and the hub keeps its feed. A test pins its response byte for byte.
- **One query, two joins, no bound list of ids**: the community half as today, plus
  `friendships JOIN walls JOIN post_index`, plus the own wall, all through the existing
  `posts_by_community(community_id, created_at)` (`backend/migrations/0015_social.sql:16`). No new index. The block
  filter is the existing one (`UNBLOCKED`), and snoozes (0114) are filtered in the same statement. An anonymous post stays
  when its author is snoozed, since hiding it would let a viewer find its author by snoozing one person at a time.
- **The index learns the audience, and that leaks nothing.** `post_index.audience` (0115) is returned only on a post of a wall the viewer reads, for the card's icon (0115), as on the
  wall itself. Friends read both audiences, and a non-friend's wall never enters this query, so the feed does not need to compare
  audience per reader at all; only the person screen does.

### What it costs

The figures are the measured ones in `docs/d1-social-workload.md`, plus arithmetic. **Nothing at this size has been
measured.** The first step of the plan extends the spike.

- A community gets 7 posts a day under the doc's assumptions (100,000 accounts × 0.2 × 70% ÷ 2,000, lines 56–60). An
  account's wall gets 0.06 (0.2 × 30%).
- **A viewer with 500 friends and 50 communities therefore has 380 posts a day in its sources** (50 × 7 + 500 × 0.06).
- **A fixed window is too costly at that size.** The Worker's 30 days (`FEED_WINDOW_MS` in `posts.ts`) would read 11,400 post rows, the class
  of the measured "one scan" (19,326 rows, `docs/d1-social-workload.md:93`) that the window exists to avoid; the spike's own
  7 days (`spikes/d1-workload/model.ts:268`) would read 2,660.
- **So the window adapts**: it starts at 24 hours and widens to 4, 16 and 30 days, in at most three statements per
  request, with the cursor carrying the width. The heavy viewer reads about 2,400 rows per page, measured on a local D1 in
  [The feed at the size of 0116](../d1-social-workload.md#the-feed-at-the-size-of-0116-373) (an index entry and a table row
  for each post and wall, which the first estimate here of 1,500 left out), under the 3,000 that would call for a change.
  A light viewer's wider window reads few rows, and the existing step-back
  (in `feed`, `posts.ts`) has its counterpart here. It looks at the oldest source, a friend's wall included and not the
  friendship, because a friend's older posts are read as soon as the two are friends (0115), so stopping at the friendship
  would lose them without saying so. The three statements are two windows and that one read.
- **Storage:** `friendships` at 100,000 accounts with 50 friends each is 5 million directed rows, 0.72 GiB
  (`docs/d1-social-workload.md:79`), which is what 0060's 0.9 GiB for the graph already counted as follows.
- **Rendering is the open risk.** A page reads one Space call per community on it, in parallel
  (`render`, `posts.ts`). A page of 30 friends' posts means up to 30 object calls; a community's page has never paid this.
  **It is not measured.** The feed does not ship until a staging measurement of the 95th percentile says it holds; if it
  does not, the page gets shorter, which costs nothing else.

### The composer and the card

- **A composer on top, targeting the own wall by default, with a picker for a community.** The audience selector appears
  for the wall (0115).
- **The card names the community first when seen outside it, and the author first inside.** Today the author is always
  first (`web/src/social/post.tsx:150–165`). On a wall post the author is the only line.
- **Full-bleed at compact width**, against today's box (`post.tsx:136`).
- **Counts move inside the action pills** (`post.tsx:173–174`). The inline comment field stays
  (`post.tsx:178–186`): it is faster than opening the post.
- **The clamp stays five lines with "see more", as it already is everywhere** (`post.tsx:259`, `:272–279`;
  `android/app/src/main/kotlin/samtak/spjall/social/PostCard.kt:132–137`, `ios/App/Social/SocialParts.swift:463`).
- **0092 stands:** a featured post's place follows the screen, inside a community only.

### Measured, then decided

- **"Holds" means the 95th percentile of `GET /v1/home` under 1,000 ms warm**, because this record names no threshold. If it
  fails, the page goes to 20, then 15, and is re-measured (`HOME_PAGE`, `backend/src/api/home.ts`;
  `tooling/home-measure.mjs`, whose `--page` measures a shorter page with no deploy). Decided 2026-10-31 by the overseeing
  session, which Guðröður may overrule.
- **Multi-image layout stays as it is**: one image alone, several in two columns (`post.tsx:403`), each opening the
  viewer. A mosaic would need a per-image crop that no editor produces.
- **A ⋯ on others' posts exists**: Tilkynna for others, Eyða for the author (`post.tsx:347–365`). No change.
- **No count on a tab.** 0109 stands, and the bell keeps the count. A newest-first feed has no "unread" to count, and a
  number on it would pull people back to a feed without saying anything.

### Release order

0060's "no feed in the apps until the social slice ships after the open beta" (`0060:41`) and its third release step
(`0060:75`) are amended: the feed reaches the apps in the closed beta, web first with the apps following, behind the
moderation gate in 0115. The audience is still the closed group, and 0115's gate is what 0034 asked of a wider one.

## Why

- People open a social app to see what happened among those they care about. A list of communities and a list of
  conversations each answer a narrower question.
- Read per source in a window is 0060's design and has a measurement behind it; adaptive width keeps the same shape for
  the viewer the measurement did not cover.
- Keeping `/v1/feed` untouched makes this additive for every installed app.

## Rules out

- Ranking, or anything in the feed the viewer did not choose: suggestions, ads.
- Stories, and memories of past posts: nothing here depends on them, and a memory is a kind of ranking.
- Saved posts: no stated need, and it would be another list to moderate and to delete.
- Fanning a post out to its readers.
- A count on a tab.
