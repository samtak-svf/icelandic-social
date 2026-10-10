# 0024. Block is per account: the server refuses new contact, the core hides the rest

- Status: accepted; implemented in the backend (#55) and the core (#58); the apps offer it
  since #64 and #67
- Date: 2026-10-07
- Decided by: the maintainer, approving the plan for the conversation UI
- Builds on: [0009](0009-v1-scope.md) (block is in v1),
  [0018](0018-the-client-engine-in-the-core.md) (membership by commit),
  [0020](0020-membership-bound-to-commits.md)
- Amended by: [0034](0034-fljotid-and-the-wall.md) (block extends to posts in Fljótið),
  [0039](0039-profile-photo.md) (block withholds the profile photo, both ways)

## Decision

- **A block is one account blocking another**, stored in a D1 `blocks` table (blocker,
  blocked, time). `PUT /v1/blocks/{accountId}` and `DELETE /v1/blocks/{accountId}` set and
  lift it; `GET /v1/blocks` lists the caller's own blocks for "Ég". Both are reversible.
- **The server refuses new contact from a blocked account.** It cannot claim the blocker's
  KeyPackages (`403 blocked`), so it cannot add the blocker to a conversation or open a 1:1
  from the blocker's invite link. `GET /v1/accounts/{accountId}` still answers, so a shared
  group keeps showing the name.
- **The blocker's core removes the blocked account from their shared 1:1s**, with an
  ordinary remove commit (0020). The other side sees the conversation as removed.
- **In a shared group, the blocker's core hides the blocked account's messages.** It still
  decrypts them, because the ratchet must advance, but stores them hidden: no timeline item,
  no unread count, no event. Reactions and receipts from that account are dropped from the
  fold. The server cannot drop messages per recipient in a group without breaking every
  member's ratchet, so hiding has to happen on the device.
- **Unblocking** lifts the server's refusal and shows new group messages again. Hidden
  messages stay hidden, and a removed 1:1 stays removed; a new 1:1 starts from an invite or
  the picker.

## Why

The server only needs to stop new contact; the core already controls what a device shows.
Removing the blocked account from a 1:1 ends delivery for both, which hiding alone would not.
In a group, the other members did not block anyone, so the group must keep working for them.

## Rules out

A block the server enforces by dropping group messages; a block that stops ratchet
processing; a blocked account adding the blocker to a new conversation.

## Known limits

The blocked person can tell they were blocked from the removed 1:1. They still see the
blocker's messages in shared groups, since blocking is one-sided.
