# 0080. Communities follow the group layout most readers already know, and carry a picture

- Status: accepted; implemented (#107, #109, #113, #114, #118, #120, #121, apps 0.10.1); the comment composer's photo button is designed in 0082
- Date: 2026-10-22
- Decided by: Guðröður Atli Jónsson
- Amended by: [0086](0086-images-are-framed-per-screen-size.md) (the cover is framed once for each window size class),
  [0088](0088-a-community-features-several-posts.md) (up to three featured posts, shown as a strip)
- Amended by: [0087](0087-wide-screens-get-their-own-layout.md) (wide screens: a rail, an aside, `Stjórna` as a side navigation),
  [0088](0088-a-community-features-several-posts.md) (up to three featured posts, shown as a strip),
  [0089](0089-a-community-has-tabs.md) (tabs under the header), [0090](0090-a-post-can-be-a-poll.md) (a poll button),
  [0091](0091-anonymous-posts-in-a-community.md) (anonymous posts)
- Amends: [0079](0079-community-layout-feed-and-management.md) (hub rows, community header,
  composer, post card, post screen), [0071](0071-comment-replies-and-reactions.md) (comments
  take one like), [0063](0063-communities-audiences-and-moderation.md) (a community has a
  picture and a cover)
- Amends: [0044](0044-no-fljotid-in-v1.md) (a post is shared into a conversation again, by id,
  resolved as a card)

## Decision

Nearly every Icelandic reader already uses one established social network's groups every
day. A community here is laid out the way those readers already know, surface by surface,
so nothing has to be learned before it can be used. Where this record and 0079 differ, this
record wins; what 0079 decides and this record does not touch (the chronological feed, the
three hub tabs, `Um samfélagið`, `Stjórna` and its rows) stands unchanged.

### A community has a picture and a cover

- **A community carries an optional square picture and an optional wide cover.** The owner
  or a moderator sets or removes either from `Stjórna` → `Breyta samfélagi`, and from the
  create screen. Each change is a moderation log entry
  ([0066](0066-moderation-in-d1.md)).
- **Images go through the account-photo path, not a second copy of it.** The upload is
  decoded and re-encoded to WebP with its metadata dropped (picture 512×512, cover
  1600×600), SVG is refused, and the stored object is addressed by a version token so a
  changed picture is a new URL. Accounts and communities call one helper.
- **A private community's picture is as private as its posts.** It is served through the
  authenticated social media read and only to an account the community's read rule admits;
  a signed-out request or a non-member's request is refused. An open community's picture is
  readable by any signed-in account.
- **Without a picture the rounded tile with the initials from 0079 is drawn**, so nothing
  changes for a community that never sets one.

### The hub

- **A row is the picture, the name and the last activity.** The name is bold while the
  community has posts the reader has not seen, with `{count} nýir póstar` and a dot beside it;
  otherwise the row says when it was last updated.
- **Unread is counted on the server**: `community_reads(account_id, community_id, read_at)`
  moves when the reader opens the community's feed, and the hub response carries the count.
- **A reader can pin a community** to the top of `Mín samfélög`. The pin is stored per account
  on the server, so it follows the reader to every device.
- **`Stofna samfélag` is a row that opens its own screen.** The create form and the search field
  are no longer inline on the hub; search sits behind the search icon in the header.

### The community header

- The cover, when set, sits above the picture and a large name.
- **The audience line reads `Lokað samfélag · {count} meðlimir` with a lock, or
  `Opið samfélag · {count} meðlimir`**, and opens `Um samfélagið` as 0079 says.
- **A row of member pictures and a `Bjóða` button** follow. In a private community `Bjóða`
  sends the existing invitation ([0063](0063-communities-audiences-and-moderation.md)); in an
  open one it shares the community's card.
- `⋯` and search sit in the top bar. `Stjórna` remains its own screen on every client,
  the web included, and `Eyða samfélaginu` is reachable only from there.

### The composer and the post card

- **The composer is one row**: the reader's own picture, the `Skrifaðu eitthvað…` prompt and a
  photo button. Tapping either opens 0079's sheet or dialog.
- **A card reads top to bottom as**: picture, name, a role badge for a moderator or the owner,
  relative time (`6 klst.`), and `⋯` holding `Eyða`, `Tilkynna` and, for a moderator, `Festa`;
  then the body clamped to five lines with `Sjá meira`; then a reaction summary line with the
  reactions used and their count; then one row of three equal actions, `Líkar`,
  `Athugasemd` and `Deila`; then the newest comment as a preview and a
  `Skrifaðu athugasemd…` pill.
- **`Líkar` gives 👍 on a tap**; a long press (or hover on the web) opens the five reactions of 0063. The five reactions are no longer drawn on every card.
- **`Deila` sends the post into a conversation as the post card** that #288 already resolves,
  or copies its link (`Afrita tengil`). The card resolves through the post's own access check,
  so a member of a private community who shares a post into a conversation shows it only to
  the recipients the community also admits; everyone else sees the unavailable card.
- **A post can be pinned** to the top of its community's feed by a moderator or the owner
  (`Festa` / `Losa`), one at a time, logged like any moderation action. The feed stays
  chronological beneath it.

### The post screen

- Back sits in the top bar; the comments are grey rounded bubbles with picture, name and role
  badge, and under each bubble `{time} · Líkar þetta · Svara`.
- **A comment takes one reaction, 👍, with a count.** This amends 0071, which ruled reactions
  on comments out. It is stored with the post reactions in the community's `Space` object,
  restricted to 👍, and it notifies nobody.
- 0071's one level of replies, its tombstone and its moderation stay exactly as decided.
- The comment composer stays pinned to the bottom (0079) and carries a photo button.

### Navigation on the web

The web's text tabs become an icon tab bar, the same four places the apps have, with the
notification count as a badge. At phone width it sits at the bottom of the screen.

## Why

On 2026-10-22 the community screens were compared side by side at phone size with the groups
most Icelanders use daily (the named comparison is kept privately, under 0073). The gaps that
made the screens feel foreign were not features but layout: no picture on a community, no sign
of what is new, tools and a red delete button in the reading path, five reaction circles where
readers expect one `Líkar`, and no way to pass a post on. A reader who has to relearn where
things are does not come back, and closing these gaps costs no new principle: the feed stays
chronological, the roles of 0063 stay the only roles, and every new surface reads through an
access check that already exists.

A picture is the one thing readers named outright. A group without one looks unfinished, and
the account-photo pipeline already does the hard part (re-encoding, refusing SVG, versioned
addresses), so the community's picture is one more owner of the same helper rather than a new
image path.

Comment likes were ruled out in 0071 to keep the thread about the writing. One 👍 with a count,
no other reaction and no notification, keeps that intent while giving readers the
acknowledgement they reach for by habit.

## What it rules out

- A ranked or personalized feed: newest first stays (0079); a pinned post is the only
  exception, chosen by a person and visible as pinned.
- More than one reaction on a comment, or a notification for a comment like.
- A community image served publicly when the community is private, or an image path that does
  not go through the shared re-encoding helper.
- Moderator and owner tools on the hub, the header's reading path or a card, beyond `Festa` in
  the `⋯` menu.
- Sharing a post anywhere its own access check would not show it.
