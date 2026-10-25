# 0009. The first release is chat only, for a closed test group

- Status: accepted; amended by 0033, 0034, 0036, 0039, 0040, 0041, 0042, 0044, 0046, 0059, 0060, 0063, 0071, 0076, 0078, 0079, 0082, 0084, 0086, 0087, 0088, 0089, 0090, 0091 and 0094
- Date: 2026-10-05
- Decided by: Guðröður (the scope questions); the implementation choices below follow from them
- Amended by: [0033](0033-google-sign-in-and-kenni-verification.md) (the invite is no longer the beta gate),
  [0034](0034-fljotid-and-the-wall.md) (Fljótið and the wall: three tabs, finding people),
  [0036](0036-everyone-signed-in-is-in-the-picker.md) (everyone signed in is in the picker, found by name),
  [0039](0039-profile-photo.md) (a profile photo, seen by every signed-in account),
  [0040](0040-share-a-post-into-a-conversation.md) (a Fljótið post shared into a conversation),
  [0041](0041-forward-a-message.md) (forward a message),
  [0042](0042-mute-a-conversation.md) (mute a conversation),
  [0044](0044-no-fljotid-in-v1.md) (Fljótið and the wall leave v1; two tabs again),
  [0046](0046-copy-a-message-and-open-its-links.md) (copy a message, open its links),
  [0059](0059-send-a-location.md) (a location, sent once and opened on map.is or a map app),
  [0060](0060-a-social-platform-with-an-encrypted-messenger.md) (a social platform beside the messenger, and the web as a client),
  [0063](0063-communities-audiences-and-moderation.md) (report and moderation for communities),
  [0071](0071-comment-replies-and-reactions.md) (one-level replies to comments; no reactions on comments),
  [0076](0076-an-assistant-for-testers.md) (an automated assistant for the testers' community),
  [0078](0078-a-group-name-leaving-and-who-changes-members.md) (a group name, leaving a group),
  [0079](0079-community-layout-feed-and-management.md) (the community hub's feed, the member
  list and the management screens),
  [0082](0082-a-comment-carries-one-image.md) (a comment carries one image),
  [0084](0084-testers-reach-the-maintainer-directly.md) (the automated assistant of 0076 is removed),
  [0086](0086-images-are-framed-per-screen-size.md) (an image editor: a crop for every picture, a cover framed per screen size),
  [0087](0087-wide-screens-get-their-own-layout.md) (wide screens get their own layout),
  [0088](0088-a-community-features-several-posts.md) (up to three featured posts),
  [0089](0089-a-community-has-tabs.md) (tabs in a community),
  [0090](0090-a-post-can-be-a-poll.md) (polls),
  [0091](0091-anonymous-posts-in-a-community.md) (anonymous posts, off by default),
  [0094](0094-a-group-photo-end-to-end-encrypted.md) (a group photo, end-to-end encrypted)
- Built on by: [0022](0022-the-conversation-surfaces.md) (the list, the conversation, the
  toggles), [0023](0023-media-as-encrypted-blobs.md) (photos and files),
  [0024](0024-block.md) (block)

## Decision

The design's option board (1a–1f) shows every surface at once. The design does not set the
scope. The first release (v1) contains:

| Area              | In v1                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| Messaging         | 1:1 and small MLS groups, text, photos and files, read markers, typing indicators |
|                   | A Fljótið post shared into a conversation, by its id (0040)                       |
|                   | Mute a conversation for 1 hour, 8 hours or until turned back on (0042)            |
|                   | The current place, sent once and opened on map.is or a map app (0059)             |
| Message actions   | Reply, edit, delete for everyone, reactions, disappearing messages                |
|                   | Forward, as a fresh copy marked "Áframsent" (0041)                                |
|                   | Copy a text, and open its web links on a tap (0046)                               |
| Surfaces          | Conversation list, conversation, and "Ég" (profile and settings). No other tab    |
| Identity shown    | Name, verified mark, a profile photo (0039). No place and no domicile             |
|                   | Pictures and covers framed in an editor; a cover per screen size (0086)           |
| Finding people    | A personal invite link and QR code                                                |
| Safety and rights | Block, and account deletion (`DELETE /me`)                                        |
| Audience          | A closed test group via TestFlight and Play internal testing                      |
| Communities       | Featured posts (0088), tabs (0089), polls (0090), anonymous posts (0091)          |
| Look              | 1a (dense list, bottom tabs) with 1c (classic bubbles)                            |
|                   | Medium and expanded windows get a rail and wider layouts (0087)                   |

How each item is built:

- **The invite link is also the beta gate.** A Kenni sign-in creates an account only with a
  valid invite token, minted by an existing user or by an admin. A random token carries
  nothing personal and can be rotated or revoked. It resolves on the neutral link host (App
  Link / Universal Link) to the inviter's name and verified mark, then opens a 1:1. This keeps
  the group closed without a list of kennitölur in config (0008). Admins are account ids on
  a server-side list in D1; at first only Guðröður (0010).
  [0019](0019-sign-in-and-invites.md) builds it, with the first account let in by the
  operator and the admin list deferred until an admin has something to do.
- **Edit, delete for everyone, reactions and the disappearing timer are envelope `kind`s**
  inside MLS application messages, so the server never sees them. Edit history stays on the
  device. A delete leaves a tombstone. Each client enforces the disappearing timer, and the
  `Conversation` DO's retention TTL already bounds what the server keeps.
- **Typing indicators are encrypted, ephemeral frames.** The DO forwards them and never
  stores them. Read markers are encrypted application messages. Each has one toggle in "Ég",
  and turning it off also stops receiving it.
- **Account deletion is in v1**, not left to the store package, because the right to erasure
  applies to test users too. The dialog says what the server deletes and that copies already
  on other people's devices remain.

## Out of v1, still designed

- The directory (0003), the alerts feed with system cards, and postcode channels (0007).
- Place or domicile next to a name. If it comes back, it is opt-in and off by default.
- Contact matching and name search. The server learns nothing about whom a user knows.
  (Name search among signed-in accounts is allowed by 0036.)
- Report, which needs a moderator and a process. A closed group of invited people does not.

Their brand strings left `strings.contract.json` with this record and return with their
feature, as 0007 already did for the public-channel label. A key with no screen still costs
every brand and every rename drill.

## The gate for a public release

Nothing goes to public store listing until all of these exist: report with moderation, a
privacy policy, a support site, the encryption export declaration (0002), and store review.

## Why

Chat that works well, end-to-end encrypted on both platforms, is the product. Every other
surface needs an outside data source, a moderation process or a disclosure decision, and none
of them changes the frozen ids or the protocol. So each can follow without rework.

## Rules out

- Building any surface outside the table above without a new record.
- An allowlist of kennitölur as the beta gate.
