# 0040. A Fljótið post is shared into a conversation by its id, never by a copy of its text

- Status: accepted; implemented in the core (#173) and the apps (#178, #183)
- Date: 2026-10-10
- Decided by: the maintainer, choosing it from a comparison with an established messenger
- Builds on: [0002](0002-mls-end-to-end-encryption.md), [0024](0024-block.md),
  [0025](0025-push-without-ids.md), [0034](0034-fljotid-and-the-wall.md)
- Amends: 0009 (messaging: a shared post)

## Decision

- **A new envelope kind, `post`, carries only the post's id**: `{"kind":"post","postId":…}`,
  a `Body::Post { post_id }` next to the others in `core/envelope/src/lib.rs`, with `"post"`
  added to `KNOWN_KINDS`. It is an MLS application message like any other, so the server
  that delivers it does not learn which post was shared, or with whom.
- **It is rendered from the server, at the time it is shown.** The timeline gets a
  `Content::Post { post_id }` (`core/ffi/src/client.rs`), and the app draws a card by asking
  the core for the post, which calls `GET /v1/posts/{postId}` (`post` in
  `core/client/src/feed.rs`). The card shows the author's name, mark and text, and opens the
  post's replies when tapped. The fetched post is held in memory for the screen and never
  written to the store.
- **A post that is gone shows one fixed line**, "Færslan er ekki lengur til", a new
  strings key. That is the answer whenever the route says `404`: the author deleted the
  post, the author's account was deleted (the foreign key cascade in
  `backend/migrations/0009_posts.sql`), or the reader blocked the author, since `post` in
  `backend/src/posts.ts` hides an author the reader blocked (0024, 0034). The card does not
  say which.
- **Urgent, like text** (0025). The notice says that a post was shared, in a fixed sentence,
  and does not fetch the post: the iOS extension has a time limit, and a notice must not show
  text the server could withdraw a moment later.
- **The entry point is the post's menu.** Today the menu shows only on the reader's own
  posts (`if (mine) Menu(…)` in `android/app/src/main/kotlin/samtak/spjall/feed/PostRow.kt`,
  `onDelete != nil` in `ios/App/Feed/Posts.swift`); it shows on every post, with "Senda í
  samtal" for all and "Eyða" only for one's own. It opens the conversation picker, and the
  share is sent into the picked conversation. A comment is an ordinary message after it.
- **Older clients skip it.** An unknown kind decodes to `Body::Unknown`, which the apps skip
  (the compatibility rules at the top of `core/envelope/src/lib.rs`), so a recipient on an
  older build sees nothing. In the closed test group that lasts until the next build;
  raising the version floor (0030) is the tool if it matters.

## Why

0034 deletes a post when its author deletes it or the account is deleted. A copy of the
text inside an end-to-end encrypted message would outlive both, on every device that
received it, where neither the author nor the server can reach it. Sharing the id keeps the
author in control of their words: the share shows what the server holds now, which after a
deletion is nothing. It also keeps a block working, because the server applies it to every
fetch.

## Rules out

- Copying a post's text, or its author's name, into the message or its notice.
- Storing a fetched post on the device.
- Sharing a reply, or sharing into Fljótið itself (a repost), without its own record.

## Known limits

- **Fetching the post tells the server who looked at it, and when.** The server already
  sees every Fljótið read, but a fetch soon after a message arrives in a conversation hints
  that the post was shared there. The card fetches only when it is on screen, not on
  receipt.
- A screenshot keeps the text, as with anything shown on a screen.
