# 0020. A commit carries its roster claim, and a device leaves only on an MLS removal

- Status: accepted; implemented in the backend and the core
- Date: 2026-10-06
- Decided by: the maintainer, approving the plan that followed the architecture review
- Amends: [0017](0017-conversations-on-the-server.md) (how the roster moves, and what a
  `403 not_a_member` means)
- Amended by: [0028](0028-removing-a-device-from-its-groups.md) (the claim when a sibling device leaves)

## Decision

Under 0017 the server applied whatever `roster` a member sent beside a commit, and a client
read every `403 not_a_member` as final. One member could then shut another out of a
conversation for good while MLS still held them, and nothing told the other members.

- **The claim is inside the commit.** The committing client writes
  `{"roster": [...], "welcome": [...]}` into the commit's MLS `authenticated_data`: every
  account in the group after the commit, and the accounts its Welcome is for, each sorted and
  without repeats. It is signed by the sender and is clear text in both PublicMessage and
  PrivateMessage, so the server can read it and every member can check it.
  - `POST /v1/conversations/{conversationId}/messages` no longer takes `roster` or
    `welcome.to`; `welcome` is `{message}`. There is one source for the claim.
  - The Worker refuses a commit (`400 invalid_request`) whose claim is missing, is not the
    JSON of two lists of account ids, leaves out its sender, or names Welcome recipients when
    no Welcome is sent, or none when one is.
  - The DO sets the roster to the claim when the commit wins its epoch. A Welcome recipient
    must be in the claimed roster (`400 welcome_not_a_member`), as before.
- **Every member checks the claim.** When it processes a commit, a member compares the claim
  with what MLS says: the accounts that hold a leaf after the commit, and the accounts of the
  members it adds. A commit whose claim matches is _backed_.
  - On a commit that is not backed, the member queues a corrective commit: an empty
    self-update whose claim is the true roster. A later backed commit, or its own, drops it.
    If several members correct at once, the epoch rule of 0015 keeps one.
- **A device leaves only on an MLS commit that removes it.**
  - The DO records the `seq` of the commit that left an account out. That account may still
    list messages up to and including that `seq`, so its devices fetch the commit and learn
    from MLS whether they were removed. After it, `not_a_member`. A later commit that names
    the account again clears the record.
  - The core moves a conversation to `Removed` only when it processes a commit that removes
    this device.
  - A `403 not_a_member` without such a commit moves it to `Excluded`. It is not final: the
    device keeps its group, sends nothing, and tries again on the next `notify`, which the
    corrective commit brings. When a fetch succeeds again, the conversation is `Active`.
- **The first commit is made on epoch 0**, the epoch a new group starts in. The DO refuses a
  first commit on any other epoch (`409 epoch_conflict`), so a member cannot skip epochs
  ahead of the others.

## Why

The server still cannot read a commit, but it no longer has to trust a statement made beside
one. A claim signed into the commit is the same statement every other member sees and can
hold against the commit's proposals, so a lie is detected by the members it affects and
corrected without any of them trusting the server. Making removal something a device reads
from MLS, not from a status code, means neither a lying member nor a server bug can end a
device's membership silently.

## Rules out

A roster change carried outside the commit; the server applying a roster no member signed;
a client treating a status code as proof that it was removed; a first commit on an epoch
other than 0.

## Known limits

- A claim that leaves out a Welcome recipient the commit really adds stores no Welcome for
  that account. The member's devices get the corrective commit's notify but cannot join from
  it. Joining from a GroupInfo (decision 0021) recovers them.
- Commits a client sealed before this change carry no claim, and the server refuses them.
  No such client has been released.
