# 0106. Notification levels per kind and per community

- Status: accepted; designed, not yet implemented
- Date: 2026-10-27
- Decided by: Guðröður Atli Jónsson, approving the notifications v2 plan (#308)
- Amends: [0067](0067-jobs-and-notifications.md) (per-kind settings, listed as not built)

## Decision

- **Three levels**: `off` (nothing), `in_app` (a row in the list, no push) and `push` (a row
  and a push). The default is `push`.
- **One level per kind** (`notification_settings(account_id, kind, level)`) **and one per
  community** (`community_notification_settings(account_id, community_id, level)`). The
  effective level is the lower of the two. A community set to `off` is muted.
- **The level is applied when the job runs** (0067): `off` writes no row and pushes nothing,
  `in_app` writes the row and pushes nothing.
- **A moderator's action is never lower than `in_app`**: it is never hidden from its subject
  (0067), whatever is set.
- **Each page row carries `announce`**: whether it is unread and its effective level is `push`
  now. The device announces only such rows (0107).
- **API**: `GET` and `PUT /v1/notification-settings`, `PUT /v1/communities/{id}/notification-level`.
- **Settings** has a notifications section with the five kinds; a community's menu has its level.

## Why

- A busy community or a kind the reader does not care about should be quieted without losing
  the rest.

## What it rules out

- Per-post or per-person settings, email or SMS.
