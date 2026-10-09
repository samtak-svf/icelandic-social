# 0034. Fljótið: a public feed every account is in, and each account's wall

- Status: accepted; designed, not yet implemented
- Date: 2026-10-09
- Decided by: the maintainer, approving the plan for Google sign-in, Kenni verification and
  the feed
- Builds on: [0001](0001-eu-storage-and-residency-wording.md),
  [0007](0007-postcode-groups-are-public-channels.md) (public is not end-to-end encrypted),
  [0008](0008-no-pii-in-logs.md), [0024](0024-block.md),
  [0033](0033-google-sign-in-and-kenni-verification.md)
- Amends: 0009 (the surfaces, finding people), 0022 (who sees a name), 0024 (block extends to
  posts)

## Decision

### The surfaces

- **Three tabs: Fljótið (first and the default), the conversation list, and Ég.** Fljótið is
  one feed shared by every account. Ég becomes the person's wall: their header, their posts,
  and a gear that opens a settings screen. The settings screen holds what Ég held before.
- **A wall is an account's own posts.** Any account's wall opens from its name in the feed,
  and it has a button that opens a 1:1.

### Posts

- **Fljótið is public to every signed-in account and is not end-to-end encrypted**, as 0007
  says of public channels. The screen says so in one line. Conversations stay MLS.
- **Posts, replies and reactions live in D1**, in the EU (0001). A post is text of at most
  2000 characters, and so is a reply. Each account has one reaction per post.
- **A post is kept until its author deletes it or the account is deleted** (a foreign key
  cascade). A wall is a profile, so the 30-day message retention of 0015 does not fit it.
- **Text only.** Photos in a post need their own record, because 0023 rules out unencrypted
  uploads.
- **Reading is a keyset page**, newest first, with an opaque cursor: `GET /v1/feed` and
  `GET /v1/accounts/{id}/posts`. Each item carries its author's `{accountId, name, verified}`.
- **No live push for the feed.** It refreshes when it is opened, pulled, or the app returns to
  the foreground. Sending every post to every Inbox does not scale, and a broadcast object can
  come later without changing the routes.
- **Posting is rate limited per account**, like the other write routes. Log lines carry ids
  and counts, never a body or a name (0008).

### Names and contact

- **Every signed-in account sees every account's name and mark.**
  `GET /v1/accounts/{accountId}` answers any signed-in account, not only one that shares a
  conversation (amends 0022). Everyone is in Fljótið, so the name is shown there anyway.
- **Anyone in Fljótið can open a private conversation with anyone else, without a link.** The
  core's `open_direct(account)` reuses an existing 1:1 or creates one, as `open_invite` does
  (0022). The server already allows it: a KeyPackage claim is refused only on a block.
- **The new-conversation picker stays as it is.** `people()` lists accounts met in
  conversations. The way to someone new is through Fljótið.

### Block

0024 extends to posts. The server filters them, which it can do because posts are plain JSON:

- A viewer never sees posts or replies by an account they blocked.
- A blocked account cannot reply to or react to the blocker's posts.
- A blocked account cannot open a 1:1 with the blocker, as before.

### Report and moderation

The audience is the closed test group. Report and moderation are built before the audience
grows past it, in an open beta, and the gate for a public release in 0009 still holds.

## Why

A shared feed gives testers somewhere to meet without first exchanging links, and the wall
gives "Ég" a purpose beyond settings. Public posts that every account can read gain nothing
from end-to-end encryption, while plain JSON lets the server page, filter blocks and later
moderate. Keeping posts in D1 keeps them inside the residency claim.

## Rules out

- Posts outside D1, or outside the EU.
- Photos or files in a post before a record for them.
- A post's body, or a name, in a log line.
- Contact matching or name search. The feed is the way to find people.
- An audience beyond the closed test group before report and moderation exist.
