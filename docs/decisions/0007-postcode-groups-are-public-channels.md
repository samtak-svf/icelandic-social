# 0007. Postcode groups are server-visible public channels

- Status: accepted; deferred beyond v1 (0009)
- Date: 2026-10-05
- Decided by: Guðröður (approved with the plan's open point)

## Decision

Postcode groups ("Póstnúmer 104" in the design) and any other large open group are
conversations of `kind: public`. They are **not** end-to-end encrypted: the server stores
their messages, and they are moderatable and reportable on the server. MLS is used for 1:1
and for groups up to a few hundred members.

The app says so in the channel's UI: a public channel is labelled as one, with a brand string (added with
the channels in phase 5) saying that it is visible to the service.

## Why

An MLS commit touches every member, so a group of thousands with constant join/leave churn
does not scale, and those are the groups where moderation is most needed. Pretending such a
group is private would be worse than saying plainly that it is not.

## Rules out

An encrypted badge, or the absence of a public label, on a `kind: public` conversation;
moving a private group to `public` without its members re-joining.
