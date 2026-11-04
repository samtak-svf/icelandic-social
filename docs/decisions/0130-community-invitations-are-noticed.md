# 0130. A community invitation is noticed, answered and withdrawable

- Status: accepted; designed, not yet implemented
- Date: 2026-11-04
- Decided by: Guðröður Atli Jónsson, approving the #558 plan (2026-11-04)
- Amends: [0063](0063-communities-audiences-and-moderation.md) (an invitation keeps its inviter, is answered
  explicitly and can be withdrawn), [0106](0106-notification-levels.md) (one more kind)
- Builds on: [0025](0025-push-without-ids.md), [0030](0030-client-version-floor.md),
  [0070](0070-community-deletion-and-declined-requests.md), [0103](0103-one-notification-per-thing.md),
  [0107](0107-device-announces-social-notices.md), [0114](0114-friends-and-the-person-screen.md)

## Decision

Until now a moderator's invitation (`PUT /v1/communities/{id}/invitations/{accountId}`,
`backend/src/modules/communities/membership.ts:132–167`) wrote a row and nothing else: the invited
person got no notice, no client read `invited` (`backend/src/api/communities.ts:35`), so a private
community still offered a join request, and nobody could take the invitation back (#558).

### The notice

- **A new kind, `community_invite`, with its own level** (0106's list grows by one). Its actor is the
  inviter and its target the community. One row per invitation (0103), keyed by the community and the
  invited account; invitations are never grouped. Its default level is `push`, and the push names
  nothing (0025, 0107).
- **The row lives exactly as long as the invitation.** It is withdrawn when the invitation ends for any
  reason: declined, withdrawn by a moderator, accepted, a ban, or the community or either account
  deleted. `eventStands` (`backend/src/modules/notifications/notify.ts`) also checks at send time that
  the invitation still exists and the person is not a member, so a job that runs late sends nothing.
- **The row's text** is `notice_community_invite` ("{name} invited you to the community") with its own
  badge, `invite`; a tap opens the community.

### The invited person

- **An invitation keeps its inviter**: `community_invitations.invited_by`, nullable because rows from
  before this record have none. The community carries `invitedBy {accountId, name} | null` beside
  `invited`, filled only for the invited person; nobody else learns who invited whom.
- **An invited community says so and asks for an answer**: the inviter's name
  (`community_invited_by`, or `community_invited` when the row has no inviter), with Accept (the join
  call, which an invitation admits at once) and Decline (`DELETE /v1/communities/{id}/join`, which
  removes the invitation). The join request button is not shown while an invitation stands.
- A decline is not disclosed to the inviter beyond the invitation disappearing from the moderators'
  list, the same rule as a declined friend request (0114).

### Moderators

- **A moderator sees the pending invitations** (`GET /v1/communities/{id}/invitations`: the account,
  its name, the inviter and the time) and **can withdraw one**
  (`DELETE /v1/communities/{id}/invitations/{accountId}`). Both are moderator-only, like sending an
  invitation. A withdrawal withdraws the notice and writes a line in the moderation log.

### Old clients

- A client below the first app version that knows the kind never sees a `community_invite` row, in the
  list, the counts or mark-read, by `Spjall-Client`, the way 0114 withheld the friend kinds
  (`INVITE_NOTICE_CLIENT_VERSION`, a `NoticeReach` rung). That version is the app release that ships
  this record (0.23.0). The web is always current.

## Why

An invitation nobody can see is an invitation that does not exist, and one the invited person cannot
decline or the moderator cannot withdraw is a door held open with no way to close it. Naming the inviter
to the invited person only answers "why am I being asked" without telling the community who asked whom.

## What it rules out

- Inviting without a trace: every invitation reaches the invited person, unless they chose the level
  `off` for the kind or the community.
- A grouped "N invitations" row: each invitation is its own decision for the person.
- Showing the inviter to anyone but the invited person, or a declined invitation to the inviter.
