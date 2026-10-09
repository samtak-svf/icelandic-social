# 0028. A device the server no longer serves is removed from its groups

- Status: accepted; implemented in the backend (#104: the conversation devices route and the
  departed-account refusal) and the core (0.10.0: removing devices, the device check and the
  removal on revoke)
- Date: 2026-10-09
- Decided by: the maintainer, approving the plan that acted on architecture review #100
- Amends: [0014](0014-accounts-devices-and-auth.md) (who removes a deleted account's leaves),
  [0018](0018-the-client-engine-in-the-core.md) (device-level group changes),
  [0019](0019-sign-in-and-invites.md) (a revoked device's leaves),
  [0020](0020-membership-bound-to-commits.md) (the claim when a sibling device leaves)

## Decision

Revoking a device killed its token but left its leaf in every group, so the group's secrets
never moved away from it. Whoever held the device's store could read every later message.
Revocation now ends in an MLS commit that removes the leaf.

- **A leaf whose device the server does not serve is removed by the first member that
  notices.** A device is served while its D1 row exists and `revoked_at` is null. A deleted
  account has no devices, so all of its leaves go the same way, which is what 0014 asked of
  "the remaining devices".
- **The revoking device commits at once.** `revoke_device` for another device of the same
  account queues a device removal in every conversation the store knows. The removal is
  queued only after the server has accepted the revocation.
- **Every other member checks.** `GET /v1/conversations/{conversationId}/devices` answers a
  roster member with the active device ids of each roster account, and `403 not_a_member`
  to anyone else. The core asks during `sync()`, at most once an hour per conversation, and
  at once after a `409 claim_names_departed` (below). Any leaf that is not in the answer is
  queued for removal.
- **The removal is a commit like any other** (0015's epoch rule, 0020's claim):
  - `remove_devices` in `core/mls` removes named leaves. A device never removes its own leaf;
    that is leaving, which stays undecided.
  - The claim is the accounts that still hold a leaf. Removing a sibling device keeps its
    account in the roster. Removing an account's last leaf removes the account, as 0018 says.
  - A device removal is sealed before any other queued commit, so a commit the server refuses
    for naming a departed account is followed by the commit that fixes it.
  - When the leaf is already gone at seal time, the intent is dropped.
  - Removing a sibling device writes no timeline card; only an account leaving the roster
    does.
- **A deleted account stays out.** The Conversation DO keeps a tombstone for every account
  `removeAccount` drops. A commit whose claim names a tombstoned account is refused with
  `409 claim_names_departed`. Account ids are random and never reused, so the tombstone needs
  no expiry.

## Why

Revocation is the action a person takes after losing a phone, and they read it as "that phone
can no longer read my conversations". Without a commit that is untrue: MLS gives
post-compromise security only to a tree that has moved away from the lost leaf. The server
cannot make the commit, because it holds no group secrets, so a member has to. The revoking
device is the one most likely to be online, and the periodic check covers a device revoked
from a phone that then went offline, and an account deleted while the members were away.

The check is scoped to a conversation so that a device list is shown only to people who share
a group with the account, which they could already read from the ratchet tree.

## Rules out

- A device removing its own leaf (leaving a group).
- The server rewriting a roster to drop a revoked device without a commit.
- A claim that brings a deleted account back.
- Any endpoint that lists another account's devices outside a shared conversation.

## Known limits

- Until some member syncs, the revoked leaf stays. When every other member is offline, the
  window lasts until the first of them returns.
- The removal does not erase what the lost device already decrypted.
