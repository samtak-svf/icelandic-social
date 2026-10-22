# 0079. Community hub tabs, compact feed layout, and dedicated info and management screens

- Status: accepted; implemented; amended by [0080](0080-communities-follow-the-familiar-group-layout.md)
- Date: 2026-10-22
- Decided by: Guðröður Atli Jónsson
- Amended by: [0080](0080-communities-follow-the-familiar-group-layout.md) (hub rows, header, composer, post card and post screen)
- Amends: [0009](0009-v1-scope.md) (community hub feed, member list, and management screens in v1), [0063](0063-communities-audiences-and-moderation.md) (how communities, posts, members, and moderation tools are presented)

## Decision

### The hub has three parts

- **`Nýjast` is one chronological feed across the caller's communities.** It reads
  `GET /v1/feed` and shows posts newest first. Nothing reorders them: no score, no
  engagement ranking and no model decides what a reader sees, so a reader can always tell why a
  post stands where it does.
- **`Mín samfélög` lists the communities the caller belongs to** as compact rows: a
  rounded-square badge carrying the community's initials, or its audience where initials would
  say nothing, then the name and the audience with its member count. A row opens the community.
- **`Finna` is how a signed-in account reaches a community it is not in**: a search field at the
  top and the list of communities it may join or ask to join beneath it, with the audience and
  name [0063](0063-communities-audiences-and-moderation.md) already shows for a private one.

The three are tabs of one hub, so a reader moves between what is new, what they are in and what
they could join without leaving the screen.

### The header and the composer stay small in the feed

- **The description is clamped to three lines** in the community's feed header. `Lesa meira`
  opens `Um samfélagið` for the whole of it, so a long description cannot push the first post
  off the screen for a reader who knows the community already.
- **`Um samfélagið` is a screen of its own**: the full description, the notice that a
  community's content is hosted and not end-to-end encrypted
  ([0063](0063-communities-audiences-and-moderation.md),
  [0060](0060-a-social-platform-with-an-encrypted-messenger.md)), and the member list from
  `GET /v1/communities/{id}/members` with each member's role. It is what a plain member has
  instead of `Stjórna`.
- **The way in is the line under the name.** Tapping `Opið` or `Lokað` with its member count, or
  the header's info button, opens `Um samfélagið`.
- **The composer in the feed is one line.** `Skrifaðu eitthvað…` is a prompt rather than a field:
  tapping it expands the full composer as a sheet on the phones and a dialog on the web, and
  closes back to the prompt when the post is published or abandoned. The feed keeps its reading
  width the rest of the time.
- **A community's posts can be searched** from its header, with
  `GET /v1/communities/{id}/posts?q=`. A search that finds nothing says `Enginn póstur fannst.`;
  an empty field is the plain list.

### Moderator and owner tools have their own screen

`Stjórna` is reached from the community header and shown only to a moderator or the owner. Its
label carries the work waiting for that account, `Stjórna ({count})`, and its rows are the tools
themselves, in one list:

| Row                    | What it is                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `Tilkynnt efni`        | The open reports, counted by `openReports`                                               |
| `Beiðnir um aðild`     | The join requests waiting for a decision, counted by `pendingJoinRequests`               |
| `Meðlimir og hlutverk` | The member list with each role, and the owner's two role actions                         |
| `Aðgerðaskrá`          | `GET /v1/communities/{id}/moderation-log`                                                |
| `Breyta samfélagi`     | `PATCH /v1/communities/{id}`                                                             |
| `Eyða samfélaginu`     | The owner's deletion, in [0070](0070-community-deletion-and-declined-requests.md)'s form |

- **`Aðgerðaskrá` is a reading of the log, not a second copy of it.** Entries come from the
  append-only moderation log ([0063](0063-communities-audiences-and-moderation.md),
  [0066](0066-moderation-in-d1.md)); no route on this screen edits or deletes one, and an empty
  log says `Engar skráðar aðgerðir.`
- **`Breyta samfélagi` sends a name, a description and an audience**, owner only, and inherits
  [0063](0063-communities-audiences-and-moderation.md)'s rule unchanged: a private community
  never becomes open (`409 audience_locked`), while an open one may become private.
- **`Meðlimir og hlutverk` shows each account as `Eigandi`, `Stjórnandi` or `Meðlimur`.** The
  owner alone names a moderator (`Gera að stjórnanda`) and removes one
  (`Taka úr stjórnendum`), exactly the role boundary 0063 draws; a moderator reads the list and
  cannot change it.
- **The tools are nowhere else.** They are not stacked above the composer, not behind a long
  press on a post, and not reachable by a member without a role.

### Post cards and comments

- **Every byline carries an avatar of the author's initials.** A post and its comments then read
  as written by people before the names are read, without waiting on a profile photo.
- **A post's body is the way into the post.** A tap anywhere on the card opens the post screen
  with its comments; the comment count opens the same screen, so there is no separate small
  target to find.
- **`Tilkynna` and `Eyða` sit in a `⋮` menu on the byline** rather than beside the body. A
  reader cannot report or delete a post by hitting the text they meant to read, and the card
  keeps its width for what was written.
- **The comment composer is pinned to the bottom bar of the post screen.** It stays above the
  keyboard while the thread scrolls behind it, the way the conversation composer sits in
  [0022](0022-the-conversation-surfaces.md).
- **One level of comment replies ([0071](0071-comment-replies-and-reactions.md)) is wired on
  every surface**: the backend's comment routes carry `parent_comment_id`, the core's social
  client passes it through, and the apps and the web show `Svara` under a comment,
  `Svarar {name}` over the reply being written, `{count} svar` or `{count} svör` on a top-level
  comment with replies, and `Athugasemd er ekki lengur sýnileg.` for 0071's tombstone.

## Why

The first cut of the community screens put every tool a moderator has above the composer and
every action a reader has beside the text. Testers read a community as a feed and found the
tools in their way: the composer was never the first thing on screen, and a report was one
misplaced thumb away from a post. Splitting the screen by who a reader is fixes that with the
roles [0063](0063-communities-audiences-and-moderation.md) already defines, and it costs no new
permission: a member sees `Um samfélagið`, a moderator and the owner see `Stjórna`, and the two
screens hold the same community.

The same reasoning fixes the header and the card. A description clamped to three lines keeps the
first post reachable, the info screen is where a long description belongs, and one-line prompt to
full sheet means the composer takes the screen only while someone is writing. A chronological
feed needs no ranking to be useful at this size, and leaving ranking out keeps the order of a
reader's communities explainable by the posts themselves rather than by a score nobody can see.

Comment replies were decided in [0071](0071-comment-replies-and-reactions.md) and not built. The
layout work is where the thread gains its shape, so the reply prompt, the count and the tombstone
land with it instead of leaving a decided feature without a screen.

## What it rules out

- A ranked, scored or personalized feed, and any reordering a reader cannot account for.
- A permanent multi-line editor in the feed, or a composer that opens expanded before it is
  tapped.
- Reading a community's description in full on the feed header.
- Moderator and owner tools above the compose box, on a post card, or on a long press.
- A moderator changing roles: only the owner names and removes moderators.
- `Tilkynna` or `Eyða` beside the body of a post, instead of in the byline's `⋮` menu.
- A second comment thread surface with nesting beyond the one level of
  [0071](0071-comment-replies-and-reactions.md).
- Editing or deleting a moderation log entry from `Aðgerðaskrá`.
