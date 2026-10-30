# 0078. A group's name, leaving a group, and who may change its members

- Status: accepted; implemented in the core, the backend, the apps' screens and the web; amended by 0094
- Date: 2026-10-21
- Decided by: Guðröður (all four: add, remove, leave and a name; no admins)
- Amended by: [0094](0094-a-group-photo-end-to-end-encrypted.md) (a group may have a photo)
- Amends: [0009](0009-v1-scope.md) (a group name and leaving a group join v1),
  [0022](0022-the-conversation-surfaces.md) (a group is titled by its name when it has one),
  [0028](0028-removing-a-device-from-its-groups.md) (leaving, which it left undecided),
  [0047](0047-the-header-attachments-me-and-new-conversation.md) (it lifts "a group name" out
  of scope; the photo stays out)

## Decision

- **A group may have a name**, sent as an encrypted envelope body `Name { name }` inside the
  MLS content, beside the disappearing timer. The core checks it: trimmed, 1 to 64
  characters, no control characters. A blank name clears it, and the title falls back to the
  members' names. A conversation of two is not a group: the core refuses to name it
  (`NotAGroup`) and drops a name sent to one. Every member may name the group; folding a name
  writes a `name` card.
- **A joiner learns the group's settings.** After its own commit that adds an account, a
  device sends `Settings { name, timer }`, a snapshot of both. A member that sees a new device
  join externally sends one too. A snapshot that changes nothing writes no card, so a
  duplicate costs nothing. This also closes a gap the timer had: a member added later never
  learned it.
- **Leaving reuses 0028's removal by the first member that notices.** The leaving device
  calls `POST /v1/conversations/{id}/leave`, which the Conversation Durable Object records in
  `left_accounts`, then sends a `Leave` envelope and moves the conversation to `Left`, read
  only like `Removed`. The account stays in the roster, and reads the history, until a
  member's commit removes its leaves. Until then the devices listing leaves it out, and a
  claim that keeps it is refused with `409 claim_names_departed`, so the next member to sync
  removes it in an ordinary backed commit. The members are notified when it leaves. A commit
  that removes the account clears the record, so it can be added again later. Leaving again
  answers 204 and changes nothing.
- **There are no roles.** Any member may add an account (0020), remove one, or rename the
  group. The server cannot read a commit's proposals or the name, so it could not enforce a
  role anyway.
- **People are added from the existing new-group picker**, so adding reaches exactly the
  accounts starting a group already reaches.

## Why

Testers reported that a group could not be named and nobody could be added to one. Adding and
removing already worked in the core and no app called them. Leaving was the open question
0028 left: an MLS Remove proposal waits for another member to commit it anyway, and would add
a proposal path the server and the core do not have, while 0028's removal by the first
member that checks the roster is already tested. The name is end-to-end encrypted content
rather than part of the MLS group context, because the server reads the GroupInfo in clear
(0021).

## What it rules out

- A group photo.
- Admins, or any role that limits who may add, remove or rename.
- A name in the MLS group context or anywhere the server can read it.
- Adding from anywhere but the picker that starts a group.
- Leaving through an MLS proposal of one's own.
