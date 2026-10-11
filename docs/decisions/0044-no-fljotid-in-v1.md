# 0044. Fljótið and the wall leave v1: two tabs, and the posts are deleted

- Status: accepted; designed, not yet implemented
- Date: 2026-10-11
- Decided by: the maintainer, after asking what Fljótið is for once 0036 had shipped
- Builds on: [0009](0009-v1-scope.md), [0030](0030-client-version-floor.md),
  [0036](0036-everyone-signed-in-is-in-the-picker.md)
- Amends: 0009 (the surfaces: back to "no other tab"), 0034 (the feed, the wall and posts),
  0043 (the Fljótið parts of the UI pass)
- Supersedes: [0040](0040-share-a-post-into-a-conversation.md) (sharing a post into a
  conversation)

## Decision

### The surfaces

- **Two tabs: the conversation list (first and the default) and Ég.** Ég is the account's
  profile and settings again: the name, the mark, the photo (0039) and what the settings
  screen holds today. There is no wall, and a name never opens one.
- **Finding someone new is "Nýtt hjal"** (0036), and the invite link (0019). Nothing else
  changes in 0036.

### What stays from 0034

- Every signed-in account still sees every account's name, mark and photo, and anyone can
  open a 1:1 with anyone without a link (`open_direct`). 0036 and 0039 rest on these.
- Block is as 0024 had it before posts: a blocked account cannot open a 1:1 with the
  blocker, and the directory leaves blocks out both ways (0036).

### Posts are deleted

- **The server deletes every post, reply and reaction.** A D1 migration drops `posts`,
  `post_replies` and `post_reactions`. Nothing is kept or exported: a post was public text
  its author could delete at any time, and the closed test group is told in the release
  notes before the deploy.
- **The routes go**: the feed, the walls, posts, replies and reactions. The OpenAPI change
  is breaking and its PR carries `api: breaking`.
- **The core and the apps lose the feed**: `core/client/src/feed.rs`, its FFI, and the
  apps' feed and wall screens, view models and strings.

### Shared posts already in conversations

- **The `post` envelope kind stays decodable**, so a conversation that holds one does not
  break. Its card shows only the fixed line "Færslan er ekki lengur til", the same line 0040
  showed for a post that was gone, and it never asks the server: there is nothing to ask
  for. Its notice stays the fixed sentence of 0040.
- **Nothing sends a new one.** The "Senda í samtal" entry goes with the post menu, and a
  shared post can no longer be forwarded (0041 keeps text and media).

### Order of the rollout

The 0.4.0 apps open on Fljótið and call its routes, so the server changes last:

1. The record, then the core release without the feed, then the apps on it, released as
   0.5.0 to Play internal and TestFlight.
2. The backend PR may merge before that, since a deploy is a manual dispatch. It is
   deployed only once 0.5.0 is installable on both platforms, and the same deploy raises
   the client floor to 0.5.0 on both (0030), so no build that calls the removed routes is
   left running.

## Why

0034 gave two reasons for the feed: a place to meet without exchanging links, and a purpose
for Ég beyond settings. 0036 removed the first: everyone signed in is in "Nýtt hjal",
found by name. What is left costs more than it gives:

- **It runs against the product.** The app is an end-to-end encrypted messenger whose data
  stays in the EU. Fljótið is public and not encrypted, and every screen of it has to say
  so (0034, 0043).
- **It blocks the open beta.** 0034 keeps the audience to the closed test group until report
  and moderation exist, and a public feed brings duties a private messenger does not have.
  Conversations alone need neither.
- **It grows.** In two days the feed brought a wall, sharing into conversations (0040), a
  label, a pill and a request for photos, each with work on both apps, the core and the
  server.

Removing it now, while the audience is a handful of testers, costs a few deleted test posts.

## Rules out

- Hiding the feed behind a flag. Code that ships unused still has to be kept building,
  tested and translated by every brand.
- A feed, a wall, posts or reposts in v1 without a new record, which would also have to
  settle report and moderation first.
- Fetching a shared post from anywhere, or showing a copy of one.
