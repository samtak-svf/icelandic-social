# 0063. Communities have an audience, roles and a moderation log; their content is hosted, not encrypted

- Status: accepted; implemented (#306, #351); amended by [0066](0066-moderation-in-d1.md), [0070](0070-community-deletion-and-declined-requests.md) and [0071](0071-comment-replies-and-reactions.md)
- Date: 2026-10-17
- Decided by: Guðröður Atli Jónsson
- Builds on: [0001](0001-eu-storage-and-residency-wording.md), [0008](0008-no-pii-in-logs.md),
  [0024](0024-block.md) (block), [0060](0060-a-social-platform-with-an-encrypted-messenger.md)
  (spaces, one Durable Object each), [0061](0061-account-identity-session-and-device-are-separate.md)
  (sessions)
- Amends: 0009 (report and moderation exist for the social side), 0024 (block hides social
  content both ways), 0019 (the admin list returns as platform moderators)

## Decision

### What community content is

- **Hosted and access-controlled, not end-to-end encrypted.** The server reads a post to
  serve it to its audience and to moderate it. A community is never an MLS group, and a
  conversation's messages never appear in one; a screen in a community says that it is not
  encrypted (0060).
- It is stored as 0060 has it: the graph, memberships, roles and bans in D1; posts, comments,
  reactions, reports and the moderation log in the space's Durable Object, pinned to the EU.
  Nothing personal from it enters a log line (0008).
- An account's own posts to its followers are a space like a community: readable by every
  signed-in account, moderated by the account for the replies on them and by the platform.

### Audiences

| Audience  | Who reads               | Who joins                                                |
| --------- | ----------------------- | -------------------------------------------------------- |
| `open`    | Every signed-in account | Anyone signed in, at once                                |
| `private` | Members only            | By a join request a moderator approves, or an invitation |

- **Signed in, always.** Reading needs a session (0061). The audience is a column, so a
  public audience, readable without signing in, can be added later by its own record.
- Only members post, comment and react, in either audience.
- **A private community cannot become open.** Its posts were written for its members. An
  open community may become private; what was posted before stays readable by members only.
- A private community's name and description are shown to signed-in accounts so they can ask
  to join; its members, posts and member count are not.
- **Creating a community needs a verified account** (a Kenni-verified name, 0033), so every
  community has an accountable owner.

### Roles

- **Owner**, exactly one: everything a moderator does, plus naming and removing moderators,
  changing the audience, handing ownership to a member, and deleting the community.
- **Moderator**: approves join requests, removes posts and comments, mutes a member for a
  time, removes or bans a member, locks a post's comments, and handles reports.
- **Member**: reads, posts, comments, reacts and reports.
- **Platform moderator**: an account on a list in D1 kept by Samtak (the admin list 0014
  foresaw and 0019 deferred). It acts in every community, receives reports a community cannot
  handle, can remove a community and suspend an account across the platform. The list starts
  with the maintainer.

### Block

- **A block hides social content both ways.** Neither account sees the other's posts,
  comments or reactions, in a community or a personal space, and neither can reply to the
  other. A block never removes anyone from a community.
- **A moderator's duty outranks a block** in the community they moderate: reported content
  is shown to them whoever wrote it, so a block cannot hide content from moderation.

### Reports and actions

- **Anyone who can read something can report it**: a post, a comment, a community or an
  account. A report holds the reporter, the target, one reason (`unlawful`, `harassment`,
  `spam`, `other`) and an optional text of at most 500 characters. The reported account never
  learns who reported it.
- **A report goes to the community's moderators**, and to platform moderators when the reason
  is `unlawful`, when the target is a community or an account, or when the community has no
  moderator who can act.
- **A removed post or comment leaves a tombstone** saying a moderator removed it. Its author
  is told which item, which rule, and that they can ask for review once; a platform moderator
  decides the review. Nothing is hidden from its author without telling them.
- **The moderation log is append-only.** Each action records who, what, on which target, the
  reason and when. No route edits or deletes an entry. Platform moderators read every
  community's log; a community's moderators read their own.

### Retention and deletion

- **A post lives until its author or a moderator deletes it.** Nothing expires on its own
  yet; 0060 gives each space its own storage, so content does not have to expire to fit.
- **A removed item's text is kept for 90 days** for review and lawful requests, readable only
  by platform moderators, then deleted. A report is kept for a year after it is closed.
- **The moderation log is kept as long as its community exists**, and with it when a platform
  moderator removes a community, for a year.
- **Deleting an account removes** its posts, comments, reactions, memberships, follows, join
  requests and its personal space. Its reports stay, without the reporter. Log entries stay
  with the account replaced by "a deleted account". A community it owned passes to its
  longest-serving moderator; without one, the community is read-only and is deleted after
  90 days unless a platform moderator hands it to a member.

### Reaching members

- **Members read their communities; nothing fans out** (0060). The workload measurement
  ([`docs/d1-social-workload.md`](../d1-social-workload.md)) puts a fan-out of community posts
  at some two billion rows a year, against about 0.9 GiB for the whole graph after three
  years. Checking an audience is an index lookup on `community_members`, and a private
  community costs nothing extra to read.
- A notification row is written only for something addressed to one person: a reply or a
  reaction to their post, a mention, an approved join request, a moderator's action on their
  content.

## Why

- A community the size of a town cannot be an MLS group, and saying so on the screen keeps
  0002's promise exact for conversations.
- Signed-in reading first keeps the audience to people with an account, a block list and a
  way to report, while the moderation tools are new. The column leaves public reading one
  record away.
- The EU's Digital Services Act asks a hosting service for a way to report content, a
  statement of reasons to the person whose content is removed, and a way to contest it. The
  tombstone, the notice, the single review and the log are the smallest form of those.
- Verified owners and platform moderators put an accountable person behind every community,
  which a public release requires (0009's gate: report with moderation).

## Rules out

- End-to-end encrypted communities: a private group is a conversation.
- Reading without signing in, until a record adds a public audience.
- Turning a private community open.
- Hiding someone's content without telling them (shadow bans), and removal by an automated
  rule without a person deciding.
- A moderation log that can be edited or deleted by a route.
- Fanning a community post out to its members.
