# 0009. The first release is chat only, for a closed test group

- Status: accepted
- Date: 2026-10-05
- Decided by: Guðröður (the scope questions); the implementation choices below follow from them

## Decision

The design's option board (1a–1f) shows every surface at once. The design does not set the
scope. The first release (v1) contains:

| Area              | In v1                                                                             |
| ----------------- | --------------------------------------------------------------------------------- |
| Messaging         | 1:1 and small MLS groups, text, photos and files, read markers, typing indicators |
| Message actions   | Reply, edit, delete for everyone, reactions, disappearing messages                |
| Surfaces          | Conversation list, conversation, and "Ég" (profile and settings). No other tab    |
| Identity shown    | Name from Kenni and a verified mark. No place and no domicile                     |
| Finding people    | A personal invite link and QR code                                                |
| Safety and rights | Block, and account deletion (`DELETE /me`)                                        |
| Audience          | A closed test group via TestFlight and Play internal testing                      |
| Look              | 1a (dense list, bottom tabs) with 1c (classic bubbles)                            |

How each item is built:

- **The invite link is also the beta gate.** A Kenni sign-in creates an account only with a
  valid invite token, minted by an existing user or by an admin. A random token carries
  nothing personal and can be rotated or revoked. It resolves on the neutral link host (App
  Link / Universal Link) to the inviter's name and verified mark, then opens a 1:1. This keeps
  the group closed without a list of kennitölur in config (0008). Admins are account ids on
  a server-side list in D1; at first only Guðröður (0010).
  [0019](0019-sign-in-and-invites.md) builds it.
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
