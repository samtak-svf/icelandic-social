# 0021. Every commit leaves a GroupInfo, and a device joins or rejoins by external commit

- Status: accepted; implemented in the backend and the core
- Date: 2026-10-06
- Decided by: the maintainer, approving the plan that followed the architecture review
- Builds on: [0002](0002-mls-end-to-end-encryption.md) (the stored GroupInfo),
  [0006](0006-device-local-history.md) (the "new device" card),
  [0018](0018-the-client-engine-in-the-core.md) (what it left out),
  [0020](0020-membership-bound-to-commits.md) (the claim)

## Decision

Until now a device could join a conversation only from a Welcome that named it, and a device
that fell behind was `Stale` for good. A device registered after the conversation began, or
one that missed what it needed, could never read it again.

- **Every commit carries the GroupInfo of the epoch it starts.**
  - `POST /v1/conversations/{conversationId}/messages` takes `groupInfo` with every commit:
    the MLS GroupInfo the committing client exports for the next epoch, with the ratchet tree
    and the external public key, signed by the committer. The Worker refuses a commit without
    one, or with one for another group or another epoch than the commit's next
    (`400 invalid_request`).
  - The Conversation DO keeps only the GroupInfo of the latest stored commit, with that
    commit's `seq`. It is the group's public state now, not a message: it is replaced, never
    expired. It holds public keys and credentials, which name the accounts and devices the
    server already knows.
  - `GET /v1/conversations/{conversationId}/group-info` answers `{seq, groupInfo}` to an
    account in the roster, `403 not_a_member` to any other, and `404 not_found` before the
    first commit.
- **A device of a member account joins by external commit** (RFC 9420 §12.4.3.2) when no
  Welcome names it: a device registered after the conversation began, or one whose account's
  other devices were added without it. Its commit claims the roster MLS holds after it, its
  own account included, and no Welcome.
- **A stale device rejoins the same way.** OpenMLS removes its old leaf, which has the same
  signature key, in the same commit. `Stale` is no longer final: the core tries again on the
  next `sync` or `notify`. The conversation keeps its local history, and messages from
  before the join stay unread, as 0006 already says of a new device.
- **The Worker binds an external commit to the device that sends it.** For a PublicMessage
  commit from a `new_member_commit` sender, it reads the leaf in the commit's update path:
  its BasicCredential must name the sending account and device, and its signature key must
  be that device's key, as for a KeyPackage (0018). Anything else is `400 invalid_request`.
  The DO refuses an external commit whose claim changes the roster (`400 invalid_request`):
  joining adds a device, never an account. It checks the epoch first, so a join that lost
  its epoch always hears `409` and can try again.
- **The epoch rule does not change.** An external commit is made on the GroupInfo's epoch.
  If another commit took it first (`409 epoch_conflict`), the joining device drops the group
  it built and joins again at once from the newer GroupInfo, up to three times in one call;
  after that the next `sync` or `notify` tries again. A join whose answer was lost is kept,
  sealed, in the outbox and sent again as the same bytes, as any commit is (0018).
- **The joined device reads from its own commit.** Its cursor is the `seq` the server gave
  its external commit; everything after it was made on an epoch it holds.
- **Every member sees the new device.** A processed commit reports the new devices of
  accounts already in the group, from a Welcome or an external commit, as `Event::Devices`.
  The app shows the "new device" card of 0006 for it. A new account's devices are its
  membership change, reported by `Event::Membership` only.
- **`join` no longer swallows its error.** It tries the Welcome first. A Welcome that does
  not name this device, or none at all (`404`), leads to an external join; a storage
  failure is returned to the app.

## Why

0002 and 0006 promised both: a new phone that starts empty but can take part, and a group
that recovers when a device falls behind. MLS already has the mechanism, and OpenMLS builds
every GroupInfo a commit needs as it commits. Keeping only the latest one costs the DO one
row per conversation. Binding the external commit's leaf to the sending device keeps the rule
of 0018 that a device's leaf is its own; without it, a member could join a device it controls
under another account's name, which every member would trust.

## Rules out

A device joining a conversation its account is not in; an external join that adds an
account; a stale device that can never read its conversation again; the server serving a
GroupInfo older than the latest commit.

## Known limits

- The server cannot check a GroupInfo's signature or contents beyond its group and epoch. A
  member that uploads a broken one stops external joins until the next commit; it does not
  affect the members already in the group.
- A device that joins externally reads only messages after its own commit. A message sent on
  the epoch it joined from, before its commit, is not readable to it.
- The server reads only the joining leaf of an external commit, not its proposals. MLS lets
  an external commit remove leaves besides the joiner's old one, and OpenMLS does not limit
  which. Members see such a removal as any other removal, from a member account that could
  have made it with an ordinary commit; the claim and its correction (0020) apply as usual.
