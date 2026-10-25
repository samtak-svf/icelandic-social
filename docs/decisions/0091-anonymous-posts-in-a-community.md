# 0091. A community may allow posts without the author's name, and every reveal is logged

- Status: accepted; implemented in the Worker and the web; the apps follow
- Date: 2026-10-24
- Decided by: Guðröður Atli Jónsson
- Amends: [0063](0063-communities-audiences-and-moderation.md) (a post may hide its byline
  from members), [0080](0080-communities-follow-the-familiar-group-layout.md) (the composer
  and the post card), [0009](0009-v1-scope.md) (anonymous posts are in v1)
- Builds on: [0066](0066-moderation-in-d1.md) (the moderation log)

## Decision

- **Off by default.** The owner turns on `Nafnlausar færslur` in `Breyta samfélagi`; the
  change is a moderation log entry. While it is off, the option is not shown.
- **A member chooses per post.** The composer has a `Birta nafnlaust` switch. Only posts, not
  comments: a comment always carries the commenter's name.
- **An anonymous post waits for approval.** It goes to `Stjórna` beside the join requests,
  and a moderator publishes or declines it; declining tells the author, not the community.
- **Readers see `Nafnlaus meðlimur`** with a neutral picture, no verified mark and no role
  badge. Nothing in the post, its card, its share card, its route, a notification or a
  reaction list carries the author's account id to a reader.
- **The author always sees it as their own** (`Þú · nafnlaust`), can delete it, and is
  notified of its comments and reactions as for any post.
- **The owner and the moderators can reveal the author**, and platform moderators can in any
  community, through `Sýna höfund` on the post in `Stjórna` or on a report. Each reveal is an
  entry in the moderation log naming who revealed it and when, which the community's
  moderators read as they read every entry (0063). Approving a post does not reveal its author.
- **Everything else about the author still applies.** A removal, a mute and a ban act on the
  real account; account deletion deletes the post; and a block hides the post from the
  blocker, as it hides every post of a blocked account. The last means a blocker can infer
  that a hidden post came from someone they blocked; safety outranks that leak.
- **No answer turns on who the author is** (Guðröður, 2026-10-25). A moderator, who reads
  across blocks, may reply to and react to an anonymous post even when a block stands between
  them and its author; the block still holds for the author, who sees neither the reply nor a
  notice of it. A moderator may hide, remove or restore an anonymous post whatever the author's
  role, and also after the author has left, because a refusal by rank would tell them the
  author is the owner or a fellow moderator without a logged reveal. A mute or a ban names an
  account, which a moderator has only after a reveal, so those keep the rank rule of 0063.
- **The account behind it is verified as before.** Anonymity is only toward the readers; the
  server keeps the author on the post like any other.

How it is stored: the post keeps its real `author` in D1's `post_index` and in the `Space`
object; a new `anonymous` flag on both, and the community's switch in D1. The byline is
replaced at the one place bylines are built (`bylines.ts`), so no route can serve the real
one by accident, and a test asserts that no reader-facing response for an anonymous post
contains the author's account id.

## Why

The desktop comparison of 2026-10-24 (kept privately under 0073) had anonymous posting in the
composer. In a community about health, debt, a workplace or a tenancy, the question a member
most needs to ask is often the one they will not put their name to. The principle of 0063, an
accountable person behind every contribution, is kept toward the community's moderators: the
author is known to the server and can be revealed by the people responsible for the
community, and every reveal is visible in the log, so members can trust both that anonymity is
not casually lifted and that it does not shelter abuse. Approval before publishing keeps an
anonymous post from being the easiest way to post something a moderator would remove.

## What it rules out

- Anonymous comments, or anonymity in conversations.
- A post whose author the server does not know, or an unverified author behind one.
- A reveal that is not in the moderation log, or a reveal by an ordinary member.
- Anonymity switched on by anyone but the owner, or on by default.
