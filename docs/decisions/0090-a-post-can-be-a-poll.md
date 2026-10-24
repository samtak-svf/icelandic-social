# 0090. A post can be a poll, and a vote is counted, never shown

- Status: accepted; designed, not yet implemented
- Date: 2026-10-24
- Decided by: Guðröður Atli Jónsson
- Amends: [0009](0009-v1-scope.md) (polls in communities are in v1),
  [0080](0080-communities-follow-the-familiar-group-layout.md) (the composer has a poll
  button)
- Builds on: [0060](0060-a-social-platform-with-an-encrypted-messenger.md),
  [0063](0063-communities-audiences-and-moderation.md)

## Decision

- **The composer gets a `Könnun` button** beside the photo button. A poll is a post: the body
  is the question, followed by **two to six options** of up to 80 characters each. A poll
  carries no image.
- **One vote per member.** Any member who may comment may vote. A voter can change the vote or
  withdraw it until the poll is closed.
- **Results show after voting.** Before voting a reader sees the options and the number of
  votes; after voting, the count and share of each option. The author, the owner and the
  moderators see the results at once.
- **A vote is never shown to anyone.** No screen and no route lists who voted, or how; not to
  the author, not to a moderator, not to a platform moderator. The vote is stored per account
  only to keep it to one and to let the voter change it.
- **The author closes a poll** from `⋯` (`Loka könnun`); a moderator can too. A closed poll
  shows its final results to every reader and takes no more votes. There is no deadline.
- **The question and the options cannot be edited after the first vote.** Before it they can.
- **A poll is moderated as a post**: reported, removed and logged the same way, and it leaves a
  tombstone. Its comments are ordinary comments.
- **Nobody is notified of a vote.** The author is notified of comments and reactions as for
  any post.

How it is stored: the options sit with the post in the community's `Space` object, and the
votes in a `poll_votes` table there keyed by post and account, deleted with the post, and with
the account when it is deleted. `Post` gains an optional `poll` with the options, counts, the
reader's own vote and whether it is closed; a vote is a route of its own, rate-limited like a
reaction.

## Why

The desktop comparison of 2026-10-24 (kept privately under 0073) had polls one tap from the
composer, and in a community deciding when to meet or what to discuss they are the shortest
honest way to ask everyone at once. The established design shows who voted for what; here it
is never shown, because a member of a political or civic community should be able to answer
without the answer becoming part of their record, and counting needs only the totals. Hiding
results until a reader votes keeps the first voters from steering the rest.

## What it rules out

- A list of voters, or any route from which one could be rebuilt.
- More than one vote per member, or ranked and multiple-choice polls.
- A poll that closes itself on a timer, or an option added by readers.
- Polls in conversations: conversations are end-to-end encrypted and a server-counted vote
  would break that; a poll there needs its own record.
