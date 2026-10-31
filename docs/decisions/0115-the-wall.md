# 0115. The wall: an account's posts, for friends by default, moderated by the platform

- Status: accepted; designed, not yet implemented; the platform moderation screen and action route (#374), the statement of reasons, the single review, the tombstone, suspension and the notice of reports waiting (#374) and the wall's backend (#377) implemented, the rest still to come
- Date: 2026-10-30
- Decided by: Guðröður Atli Jónsson
- Amends: [0044](0044-no-fljotid-in-v1.md) ("There is no wall"; settles the report and moderation it asked for),
  [0034](0034-fljotid-and-the-wall.md) (where its wall still stands),
  [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (a wall's Space, its audience),
  [0063](0063-communities-audiences-and-moderation.md) (who reads and who moderates an account's posts),
  [0065](0065-the-space-object-and-social-media.md) (a Space is named by a community or a wall),
  [0066](0066-moderation-in-d1.md) (what was "not built yet" is the gate here),
  [0106](0106-notification-levels.md) (a kind with no level: reports waiting),
  [0009](0009-v1-scope.md) (the wall is in scope)
- Builds on: [0114](0114-friends-and-the-person-screen.md), [0007](0007-postcode-groups-are-public-channels.md),
  [0024](0024-block.md), [0039](0039-profile-photo.md), [0080](0080-communities-follow-the-familiar-group-layout.md),
  [0086](0086-images-are-framed-per-screen-size.md), [0089](0089-a-community-has-tabs.md),
  [0090](0090-a-post-can-be-a-poll.md), [0091](0091-anonymous-posts-in-a-community.md)

## Decision

### The surface

- **Ég becomes the account's wall, and the same layout is the person screen for anyone else** (0114). Settings stay
  in Stillingar: the web's tab stays (`web/src/ui/shell.tsx:105–107`); the apps have no such tab
  (`android/app/src/main/kotlin/samtak/spjall/MainActivity.kt:338–344`, `ios/App/Home/HomeView.swift:200–202`), so
  there a gear on the wall opens them, as 0034 had it (`0034:24–25`). The posts 0044 deleted stay deleted (`0060:37–38`).
- **The header** is a cover reusing the community cover and its editor (0086), the avatar overlapping it, photo
  actions behind a camera badge, one bio line, "Vottað" and the month of joining (`verified` and `created_at`,
  `backend/migrations/0001_accounts.sql:5–12`; the month only). The friend count stands where a follower count
  would. There are no follower counts.
- **The bio is at most 120 code points, with no line breaks, and is on `accounts`.** Every signed-in account sees it,
  and the cover, as they see the name and photo (0034, 0039), a block excepted. Per-field audiences are out, so
  it is written to be read by anyone signed in.
- **Tabs: Innlegg, Um, Myndir**, reusing the community tabs (0089) and images tab. Myndir shows images only from posts
  the viewer may read, so it cannot leak a friends-only image.
- **Not end-to-end encrypted, and the screen says so in one line**, a sibling of
  `community_not_encrypted_notice` (`brand/hjal/strings.is.json:324`), per 0007 and 0060.

### A wall is a `communities` row of its own kind

- **One Space object per account**, `env.SPACE.jurisdiction("eu").getByName(<wall id>)`, reusing the post card,
  composer, comments, reactions, polls and images.
- **The wall's row is in `communities`, added by
  `ALTER TABLE communities ADD COLUMN kind TEXT NOT NULL DEFAULT 'community' CHECK (kind IN ('community','wall'))`**.
  `post_index.community_id` is `NOT NULL` (`backend/migrations/0015_social.sql:9`), and the index, `social_media`,
  `space_authors`, the cover columns (`0022`, `0028`), `reports` and `moderation_log` hang off that id. A nullable
  `community_id` would rebuild the post index and block a rollback; a row reuses all of it with two additive columns.
- **The row is `audience = 'private'` and has no `community_members` row**, so a slip denies by default, and the
  feed, the hub and `handOverCommunities` find nothing (`backend/src/modules/social/posts.ts:219`,
  `backend/src/modules/communities/communities.ts:455`).
- **`live_communities` is re-created to exclude walls** (last defined at
  `backend/migrations/0030_anonymous_posts.sql:9–13`). That is not enough: `standing` reads the bare table
  (`backend/src/modules/communities/communities.ts:189–207`, at `:198`), so it gets a kind filter too. A new view,
  `live_spaces`, serves what must see both, notifications first (`backend/src/modules/notifications/notify.ts:72`,
  `backend/src/modules/notifications/list.ts:12`), with its own entry in the guard's raw list
  (`tooling/module-guard.mjs:172–180`).
- **The wall's id is random, never derived from the account**: `walls(account_id PRIMARY KEY, community_id)`, cascading
  with the account and created at the first post or cover. **The row's `name`, `name_key` and `description` hold the
  wall id, never the person's name**, because a community row outlives its purge by a year "with its name"
  (`backend/src/modules/communities/lifecycle.ts:5–10`, `:16`). The display name always comes from `accounts`.
- **API:** a wall post keeps every required `Post` field (`communityId` is the wall id,
  `backend/src/api/social.ts:88`) and adds `wall: { accountId }`. Older apps get no wall rows at all (0114).
- **Anonymous posts, featured posts and pins are off on a wall.** A post with no byline on a person's own wall
  means nothing, and featuring is for a community's readers.

### Audience

- **Each post is `friends` (the default) or `everyone`**, meaning every signed-in account. **Nobody signed out
  ever reads a wall.** It is a new nullable column, `post_index.audience` (null on a community's post), and the
  author may change it later, in D1 alone.
- **It is evaluated at read time**, in a wall branch of `spaceAccess` and `postAccess`
  (`backend/src/modules/social/access.ts:40–52`, `:94–110`) and a wall variant of `refusal` (`access.ts:57–62`,
  which today answers by role): the owner; a friend for `friends`; any signed-in account for `everyone`; never
  anyone with a block either way.
- **After an unfriend**, the other person loses every `friends` post at once. No copy exists to take back. Their own
  comments on those posts stay and stay attributed; they can still delete one by id but have no list leading to it,
  a limit this record names rather than solves.
- **A shared card outside the audience resolves to the same `unavailable`** as a deleted post
  (`backend/src/modules/social/cards.ts:23–78`, `unavailable` at `:24`, `postAccess` at `:41`). A reader cannot tell
  "not for you" from "gone". A card is resolved per reader by id (0080), so sharing widens nothing.
- **A reader sees the audience icon only on posts they may read**, which is every post they are shown.
- **On an `everyone` post** any signed-in, unblocked account may react and comment. On a `friends` post, friends may.

### Report and moderation

This is the gate 0044 set (`0044:91–92`). A wall has no community moderator, so the platform answers for it, and
what the platform has today is too little to open walls on.

**Who acts**

- **Every report on a wall post, a comment on one, or an account goes to the platform queue and to nobody else**:
  `to_platform = 1`, with the wall's id or, for an account, null (`backend/migrations/0016_moderation.sql:24`, `:31`).
  It never reaches the wall's owner, who may be the one being reported and who has remove and block already. The owner
  neither sees nor closes one.
- **The owner may delete their own posts, and remove comments on their wall.** Removal takes the path community
  moderators use (`moderateComment`): it is logged with the owner as actor and `as_platform = 0`, the text is kept 90
  days (0063), and the commenter is told through `moderated`, because there are no shadow bans (0063). There is no
  review, since it is their wall to keep; the commenter may report it. The owner's other tool is block. Mute, remove
  and ban do not exist on a wall, which has no members.
- **Platform moderators** may hide, remove and restore a wall post or comment, clear a bio, cover or photo, and suspend
  or unsuspend an account.
- **A platform moderator reads a wall post only as the target of an open report, and each read is logged.** Today a
  platform moderator reads every space (`backend/src/modules/social/access.ts:46`). That is fine for a community
  and wrong for friends-only posts, so the wall branch does not have it.
- **The log** is the same `moderation_log`, kept a year after a purge (`lifecycle.ts:16`). A deleted account appears as
  a deleted account (`0016_moderation.sql:51`). An entry with no community has no purge to wait for, so it is kept
  one year from when it was written, as `/privacy` says of the log: `moderation_log_kept` needs an existing community
  (`0016_moderation.sql:80–84`), so a new trigger (`0037_moderation_log_no_community.sql`) refuses its deletion until
  then, and the daily job (`expireLog`) deletes it after.

**What must exist before any wall write ships.** When this was written the backend had no suspension and
`web/src/routes/` held only a community's reports and log. So, in this order:

1. **A platform moderation screen on the web**: the queue, the reported content, the log and the actions. The routes
   for the queue, closing and the log exist (`backend/src/modules/moderation/routes.ts:72–106`, `:128–134`); no
   client reads them.
2. **A platform action route that needs no community.** `act` starts from a community
   (`backend/src/modules/moderation/actions.ts:160–172`), and an account report has none. Built as
   `POST /v1/moderation/actions`, for an account's photo and its suspension so far; a bio and a cover add to it when
   they exist. Clearing a photo tells the person, through the notice of step 3.
3. **The statement of reasons, the single review and the tombstone** 0063 promised and 0066 listed as not built.
   One review per log entry, asked for by the person whose content it was; a platform moderator decides, never the
   one who acted or asked. A cleared photo cannot come back, and the person is told so. Overturning restores only when
   no later hide or remove of the same content stands: the older decision falls, the newer one is not undone by it, and
   the person is told the content does not come back. An overturn that does restore writes two entries in one batch,
   `review_overturned` and `restore_post` or `restore_comment`, so the replay of a restored space (0068) reads only
   what it always read; one that restores nothing writes only `review_overturned`.
4. **Suspension**, which does not exist: a column on `accounts`, timed or open. It stops posts, comments, reactions,
   friend requests and creating or joining a community. It does not touch conversations, which are end-to-end
   encrypted and which a person may need. The person is told and has one review. Built: poll votes and inviting are
   refused as well, and moderating in a community they already moderate continues
   (`backend/src/identity/suspension.ts`); friend requests and editing take the same seam when they exist. The log
   entry keeps the end date it was decided with (`moderation_log.suspended_until`), so a statement, the log and a
   review card say how long it was for after the account's own columns have moved on; no date means until a moderator
   lifts it. A notice about it goes only to a client that words it, `SUSPENSION_NOTICE_CLIENT_VERSION`: 0.19.0 decodes
   the action but would call it a removal.
5. **A grouped notice to platform moderators when reports wait**, because otherwise nobody looks at the queue.
   Built as a new kind, `reports_waiting` (`0042_reports_waiting.sql`), on these decisions, taken 2026-10-30 by the
   overseeing session, which Guðröður may overrule:
   - **One row per moderator, never one per report**, on 0103's rule: a report that newly waits moves it to now and
     makes it unread. A report already open that is sent again writes nothing and tells nobody.
   - **It names nobody and nothing.** No actor, no community, no post, no count; a report's author is not an actor, so
     `actor_id` is NULL on the row and on its events in `notification_actors`. The web shows the "?" of a notice with
     no community, and the row opens the queue at `/moderation`.
   - **Who is told:** every account on `platform_moderators` when a report arrives with `to_platform = 1`, except the
     moderator who made it, and across a block, since a moderator's duty outranks it. Nothing moves a community's
     report to the platform today, so filing is the one way in. A job run twice has one effect.
   - **It stops being true:** closing the platform's last open report removes every moderator's row in the batch that
     closes it, and a job that runs later finds the queue empty and writes nothing. A community's report does neither.
   - **The web only, and no device push.** No app has the queue, so `REPORTS_NOTICE_CLIENT_VERSION` is above every app,
     withheld by the seam of 0114; no web push exists either. The limit is stated: a moderator is told only by opening
     the web. Apps word it in Step 7 (#379), if at all.
   - **It is not a setting**, as `moderated` is not: `effective()` answers `in_app` for the kind whatever is stored, and
     the settings API has no key for it. `notification_settings`' check is not widened, so no row can exist for it.

   What this leaves open: a moderator added later is not told of a report already waiting, until the next one; a
   moderator removed by hand keeps the row until the queue empties; the 90-day expiry of `notifications` removes a row
   whose report is still open, until the next report; a moderator may remove their own row, and the next report writes
   it again; and a report closed between a job's check and its write leaves a row on an empty queue until the next
   report closes or arrives.

6. **At least one row in production's `platform_moderators`** (`0016_moderation.sql:6–9`: never by a route), verified
   by the maintainer. This record's author could not check production.

### Block, deletion, retention

- **A block filters both ways**, as for community content (0063), and a moderator's duty still outranks it.
- **Deleting the account purges the wall**: `forgetAccount` marks the row deleted and purged, `dropSpace` empties the
  object (`backend/src/modules/social/lifecycle.ts:15–23`, `:30–42`), the cover object goes, and the row stays a year
  holding no name.
- **A post is kept until its author deletes it or the account is deleted**, as 0034 had it (`0034:35–36`).
- **`/privacy` changes in the PR that ships writing to a wall**: that wall posts, bios and covers are hosted and not
  end-to-end encrypted, who reads each audience, that a platform moderator reads a post only on a report, how long
  removed text and the log are kept.

### Left out

- **Per-field audiences:** one bio with one audience is what can be explained in a sentence.
- **Stories and highlights:** a different retention and a different screen, for no stated need.
- **Writing on another person's wall:** it needs its own moderation, and the owner would answer for others' words.
- **View-as:** not cheap, since it needs a second run of every access check; the audience icon does most of the job.
- **Album management:** Myndir is a view of posts, not a store of its own.

## Why

- A wall that is a person's own speech, read by default by people they agreed to, gives Ég a purpose without
  reintroducing the shared public room 0044 removed.
- Reusing the community row reuses the post index, images, reports and log. Every parallel path would need its own
  residency, deletion and moderation story.
- Reports never go to the owner because the people most likely to be reported on a wall include its owner. Reading only on
  a report keeps friends-only posts from being a moderator's browsing.
- Opening walls before step 1–6 would repeat what 0044 removed: a place for speech with nobody answering for it.

## Rules out

- A wall readable signed out, or any public or indexable profile.
- A platform moderator browsing friends-only posts.
- Reports on a wall reaching its owner, or shadow bans.
- Wall content in an MLS conversation, or a claim that it is encrypted.
- Restoring the posts 0044 deleted.
- Shipping a wall write before the six steps above.
