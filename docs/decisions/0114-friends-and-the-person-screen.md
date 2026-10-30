# 0114. Friendship is mutual, and a name opens a person

- Status: accepted; designed, not yet implemented
- Date: 2026-10-30
- Decided by: Guðröður Atli Jónsson
- Amends: [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (the graph holds friendships, not follows; feeds read friends),
  [0044](0044-no-fljotid-in-v1.md) ("a name never opens one"),
  [0024](0024-block.md) (a block ends a friendship and clears requests),
  [0080](0080-communities-follow-the-familiar-group-layout.md) (report reaches an account from its screen),
  [0106](0106-notification-levels.md) (two more kinds),
  [0009](0009-v1-scope.md) (friends and the person screen are in scope)
- Builds on: [0034](0034-fljotid-and-the-wall.md) (`open_direct`, names seen by every signed-in account),
  [0036](0036-everyone-signed-in-is-in-the-picker.md) (the directory, unchanged),
  [0039](0039-profile-photo.md), [0042](0042-mute-a-conversation.md),
  [0063](0063-communities-audiences-and-moderation.md), [0103](0103-one-notification-per-thing.md),
  [0107](0107-device-announces-social-notices.md), [0030](0030-client-version-floor.md)

## Decision

### Friendship

- **A friendship is symmetric: one account asks, the other accepts.** No one-way follow exists and no
  follow API is built. 0060's "follows" (`0060:47`), "one per account's posts to its followers"
  (`0060:51–52`) and "joined or follows" (`0060:97`) read as friends and walls from here on.
- **Two D1 tables, owned by a new `modules/friends`**, given their owners and reads in
  `tooling/module-guard.mjs` (the lists are at `tooling/module-guard.mjs:55–92` and `:95–166`):
  - `friend_requests(from_account, to_account, state, created_at, closed_at)`, primary key the
    directed pair, so a pair holds its last attempt and never a backlog.
  - `friendships(account_id, friend_id, since)`, **two directed rows per friendship, written in one
    batch**. The feed then joins on `account_id` with no `OR`, and the row has the shape and the cost
    of the follows that were measured (155 bytes a row, `docs/d1-social-workload.md:79`).
- **The states of a request:**

  | From       | Event               | To          | Who is told                     |
  | ---------- | ------------------- | ----------- | ------------------------------- |
  | (none)     | request             | `pending`   | the recipient                   |
  | `pending`  | accept              | `accepted`  | the sender                      |
  | `pending`  | decline             | `declined`  | nobody                          |
  | `pending`  | sender cancels      | `cancelled` | nobody; the notice is withdrawn |
  | `pending`  | 30 days pass        | `expired`   | nobody; the notice is withdrawn |
  | `accepted` | either side ends it | `ended`     | nobody                          |
  | `accepted` | either side blocks  | row deleted | nobody                          |

- **A pending request expires after 30 days**, in a daily job of the shape of `expireReports`
  (`backend/src/modules/moderation/reports.ts:291`). Thirty days is long enough for someone away, leaves
  no year-old backlog, and is what lets a decline stay silent.
- **Decline is silent.** The sender goes on seeing "Beiðni send" until day 30, and then the request ends
  exactly as an expired one does. Nothing the sender can read tells the two apart.
- **One re-send rule: one request per direction per 90 days, counted from the last request's creation,
  whatever became of it.** The same refusal answers after a decline, an expiry and a cancel, so a refusal
  discloses nothing and cancelling cannot be used to knock twice. The other side may send its own request
  at any time. An `ended` friendship restarts no clock: the old request is normally long past, and the next
  one falls under this rule. A closed row is deleted once its 90 days are over.
- **Crossing requests become a friendship at once.**
- **At most 20 new requests per account in a rolling 24 hours, counted in D1**, because a Workers rate
  limit counts per location (`backend/cloudflare.config.ts:119–128`) and this limit has to hold.
- **At most 1,000 friends**, refused visibly at accept. It bounds the feed's cost (0116).
- **Ending a friendship tells nobody**: no notification, no line anywhere. The other person sees "Bæta við
  vini" the next time they open the screen.

### The person screen

- **A name anywhere opens it**, at `/people/{id}`, for a signed-in account only. There is no public profile.
  A signed-out visitor to the link is sent to sign in and learns nothing about the person, not in the title
  or the metadata either. The layout is the wall of 0115.
- **It shows** the cover, photo, name, mark, bio, shared communities (both are members, so it discloses
  nothing to the viewer), the friend count and mutual friends.
- **Its actions depend on the relation:** Bæta við vini / Beiðni send / Svara beiðni / Vinir, Hjala
  (`open_direct`, 0034), and a ⋯ with Loka á, Tilkynna and Afrita tengil.
- **A block either way answers 404 on the screen's route.** `GET /v1/accounts/{accountId}` keeps answering as
  0024 has it (`0024:25–26`), so a shared group keeps showing the name.
- **"Nýtt hjal" and its directory stay as 0036 has them.** The directory lists every signed-in account and
  its route is unchanged (`backend/src/modules/profiles/people.ts:29`).

### Lists

- **Your own:** incoming requests, sent requests, and your friends with their count, name search, sort by
  newest or by name, and friends-since.
- **Someone else's list is never shown; only its count and the mutual friends.** A friend list exposes
  associations, and half of every entry is the other person's data, which they did not publish by accepting
  a request. It is also what a scraper or a harasser would read first. The count discloses no name. Mutual
  friends are people the viewer already knows are their own friends, so it adds only the fact the viewer's
  own friend also knows this person; the query joins the viewer's set with theirs, at most 1,000 probes.

### Block, report, snooze

- **A block ends the friendship and clears the requests, both ways**, cooldown included, in one batch with the
  block row. Today's route calls `identity.block` directly (`backend/src/modules/profiles/people.ts:41–48`,
  the call at `:45`), and identity may not write another module's table, so the route moves to a function in
  `backend/src/compose/`, beside `deleteAccount` (`backend/src/compose/account-deletion.ts:17–28`). Unblocking
  restores nothing.
- **Report reaches an account from the ⋯.** The API takes it already (`account` in `REPORT_KINDS`,
  `backend/src/api/moderation.ts:14`), it has no community (`backend/src/modules/moderation/reports.ts:57–58`)
  and goes to the platform (`reports.ts:72–73`). What the platform does with it is 0115's gate. A report on
  an account covers its name, bio, cover and photo.
- **Snooze hides a person's posts from the feed for 30 days**: `person_snoozes(account_id, target_id, until)`,
  in D1 because the feed's query joins it. It tells nobody, can be lifted early, and has its own list. It filters
  the feed only, never notifications and never the person screen. 0042 keeps its meaning (a conversation's mute,
  in the Inbox); this is the same idea for a different surface, so 0042 is built on and not changed. 0106's
  "no per-person settings" stands for notification levels: a snooze is not a level.

### Suggestions

- **Only from co-membership of `open` communities** (`backend/migrations/0014_communities.sql:16`), because a
  private community's membership must not reach a third party. Never from mutual friends, which would disclose
  another person's list by inference. Never from contacts: contact matching stays ruled out (0034).
- They leave out the blocked, friends, anyone pending and anyone inside the 90 days, are capped per page, and a
  setting takes an account out of them in both directions. **They are built last**, and nothing depends on them.

### Notifications

- **Two kinds, `friend_request` and `friend_accepted`, each with a level** (0106's list becomes seven). One row
  per event (0103), keyed by the pair. The push names nobody (0107). `friend_request`'s row is withdrawn when the
  request stops being pending, through the check `stillSo` makes
  (`backend/src/modules/notifications/notify.ts:17–34`).
- **These rows have no community.** `notifications.community_id` is `NOT NULL`
  (`backend/migrations/0034_notification_groups.sql:21`), its kind check is closed
  (`0034_notification_groups.sql:19`, `0036_notification_settings.sql:7`) and `write` requires a live community
  (`notify.ts:72`). So the table is rebuilt as 0034 was, with a nullable `community_id`, and the settings check
  widened.
- **0.17.x apps must never see one.** The core tolerates an unknown kind
  (`core/client/src/api/notifications.rs:138–140`, `:169`) but `community_id: String` is required
  (`core/client/src/api/notifications.rs:155`), so one row with a null fails the decode of the whole page. The
  server therefore withholds rows with a new kind, a null community or a wall (0115) from any client below the
  first version that decodes them, in the list and in the unseen count, by `Spjall-Client`
  (`backend/src/shared/client-version.ts:10–11`). The core's decode becomes optional in the same step. The contract's
  nullable `communityId` is a breaking change on paper and carries the label `api: breaking`; the withholding
  is why it breaks nobody.

### Deletion and privacy

- **Deleting an account removes every row in both directions**: friendships, requests, snoozes and suggestion
  opt-outs, in `deleteAccount`. Counts fall accordingly.
- **The PR that ships this changes `/privacy`** (`web/src/routes/privacy.tsx:11–26`,
  `brand/hjal/strings.is.json:453`, `:455`). It must say: friend lists and requests are stored; who sees the count
  and mutual friends; that a list is not shown to others; that a decline is not disclosed; that everything is
  removed with the account; and how long a closed request is kept (90 days).

## Why

- Symmetric friendship matches who the audience of a wall post is in this product: people one has agreed to,
  which is what makes "Vinir" a meaningful default in 0115. A one-way follow would make the default audience
  anyone who pressed a button.
- A person screen is what the rest hangs on: every friend action, report and block needs a place to be, and
  today a name leads nowhere.
- A single clock that ignores what happened is the only re-send rule that cannot be read for a decline.
- Directed rows cost twice the rows and buy a feed query that the measured workload already describes.

## Rules out

- A follow, a follower count or a one-way subscription.
- Showing another person's friend list, or suggesting from it.
- Telling anyone about a decline, a cancel, an unfriend or a snooze.
- Contact matching or address-book upload.
- A person screen for a signed-out reader.
