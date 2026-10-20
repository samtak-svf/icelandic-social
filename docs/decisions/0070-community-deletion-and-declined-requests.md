# 0070. A deleted community can be restored for 30 days, and its log is kept a year; a declined request waits 30 days

- Status: accepted; implemented (#368–#370, #372–#376)
- Date: 2026-10-19
- Decided by: Guðröður Atli Jónsson
- Amends: [0063](0063-communities-audiences-and-moderation.md) (deleting a community, the
  log kept a year after a platform moderator removes one, join requests)

## Decision

### Deleting a community

Until now deleting a community deleted its row at once, and its moderation log and its
reports went with it by their cascade. 0063 kept the log a year after a platform moderator
removed a community; deletion could not do that. A community now passes through four states.

| State    | What the members see                                 | What is kept                                    | Ends                       |
| -------- | ---------------------------------------------------- | ----------------------------------------------- | -------------------------- |
| Live     | Everything                                           | Everything                                      | When it is deleted         |
| Deleted  | Nothing: not listed, no posts, feed or notifications | Everything; a platform moderator can restore it | 30 days after the deletion |
| Purged   | Nothing                                              | Its name, its moderation log and its reports    | A year after the deletion  |
| Row gone | Nothing                                              | Nothing                                         |                            |

- **The owner or a platform moderator deletes it**, and it is gone for everyone at once.
- **Only a platform moderator restores it**, within the 30 days. Restoring brings back the
  members, the posts and the notifications as they were.
- **The daily job purges it after 30 days**: the space, its images, the post index, the
  members, the requests, the invitations, the bans and the notifications.
- **The log and the reports are kept a year after any deletion**, whoever deleted it, and only
  platform moderators read them. Then the row goes, and they go with it by their cascade.
- **Deleting closes the community's open reports** with the decision `community_deleted`, and
  deleting and restoring are logged as `delete_community` and `restore_community`, so the
  year-long log says who did it.
- **A read-only community** (its owner's account deleted with no moderator left, 0063) is purged
  by the same job 90 days after it became read-only, so there is one deletion path.
- Every module but `communities` reads the view `live_communities`, which leaves out a deleted
  community; `tooling/module-guard.mjs` refuses a bare read of `communities` elsewhere.

### A declined join request

- **A declined request stays, as the account's answer**, and the community's page tells the
  account its request was declined. No notification is sent.
- **The account cannot ask again for 30 days** (`409 join_declined`). Withdrawing does not lift
  the decline; an invitation does.

### Reports say how they were closed

A report carries its decision (the action taken, `dismissed`, or `community_deleted`), the
resolution or reason given, who closed it, and where its target stands now: the account's
standing in the community and the state of the post or comment. A client then offers only the
verbs that still apply.

## Why

- A delete that cannot be undone, and that also erases the record of who did what, serves
  neither a moderator who made a mistake nor a person who later asks what happened.
- One view for every reader outside the owning module means a forgotten filter cannot show a
  deleted community, and the guard keeps it that way.
- A declined person who can ask again at once turns a decision into a queue the moderators must
  answer again and again; a visible answer is kinder than a request that silently waits.

## Rules out

- An instant, irreversible deletion of a community.
- A deleted community's log or reports read by anyone but a platform moderator, or kept more
  than a year after its deletion.
- A declined account asking again within 30 days without an invitation.
- A notification of a declined request.
