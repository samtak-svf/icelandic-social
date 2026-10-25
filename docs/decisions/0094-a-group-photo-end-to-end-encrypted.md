# 0094. A group may have a photo, end-to-end encrypted like its name

- Status: accepted; designed, not yet implemented
- Date: 2026-10-25
- Decided by: Guðröður Atli Jónsson
- Amends: [0009](0009-v1-scope.md) (a group photo joins v1),
  [0078](0078-a-group-name-leaving-and-who-changes-members.md) (it lifts "a group
  photo" out of what it rules out; the snapshot carries the photo too),
  [0047](0047-the-header-attachments-me-and-new-conversation.md) (the photo it kept out),
  [0023](0023-media-as-encrypted-blobs.md) (one kind of object outlives the 30 days)
- Builds on: [0002](0002-mls-end-to-end-encryption.md), [0008](0008-no-pii-in-logs.md),
  [0039](0039-profile-photo.md) (where photos are kept)

## Decision

- **A group may have a photo, and only members can see it.** It is end-to-end encrypted
  like the group's name (0078). A conversation of two is not a group, so the core refuses
  to give it a photo (`NotAGroup`) and drops a photo sent to one; a 1:1 conversation keeps
  showing the other person's profile photo.
- **The core makes the picture, so no client can leak what is in the file.** Before
  `set_group_photo(conversation, path)` encrypts anything, the core decodes the image,
  crops it to a centred square and scales it to 512 by 512 px. It then encodes the pixels
  as a new JPEG. The original file's metadata (EXIF location, the camera) is therefore
  never copied, and a core test holds that a photo with a GPS tag comes out without one.
  The server cannot re-encode it the way it does a profile photo (0039), because it never
  sees the picture.
  The core reads JPEG, PNG and WebP; an app hands it any other format (HEIC from a phone's
  camera) converted to one of those first, and the core's re-encode is still what is sealed.
- **The picture travels as an encrypted blob, and its key only inside MLS.** It is sealed
  as in 0023, under a fresh AES-256-GCM key. A new envelope body,
  `Photo { photo: Option<{ id, mime, size, key, sha256 }> }`, sits beside `Name`; `None`
  clears the photo. The `Settings` snapshot that a joiner receives (0078) gains an optional
  `photo` with the same fields, so a member added later sees it. A client that predates
  this record ignores the field and the kind, and shows the group as before.
- **It is kept for as long as the group has it, not for 30 days.** A group photo is set
  once and shown for months, so it cannot expire with the messages. It is kept in
  `spjall-profiles`, the EU bucket with no lifecycle rule (0039), under
  `groups/<conversationId>/<mediaId>`.
  - `PUT /v1/conversations/{id}/photo/{mediaId}` takes the ciphertext from a member of
    the roster and refuses more than 1 MB.
  - `GET` on the same path answers only to a member (`403 not_a_member`), as 0023 does.
  - A D1 row records which object is the conversation's photo. The server keeps one per
    conversation: setting a new one deletes the old object, and
    `DELETE /v1/conversations/{id}/photo` deletes it when the photo is cleared.
  - The object is also deleted when the conversation ends (no account left in its roster).
    `DELETE /me` does not delete it, because it is the group's photo and not the uploader's.
  - The server learns that a group has a photo and how large it is, never the picture.
- **Any member may set, replace or clear it**, as with the name; there are no roles (0078).
  Folding a photo writes a `photo` card in the timeline ("X changed the group's photo").
- **Every client shows it** in the conversation list, the conversation header and the
  group's info screen, on Android, iOS and the web. Without a photo a group shows the
  initials mark it shows today.
- **No log line carries the photo's id together with an account id** (0008).

## Why

Testers asked to give a group chat a picture. They also asked whether group chats are
encrypted, since in some established messengers they are not by default. Here every
conversation, a group included, is MLS end-to-end encrypted (0002) and has no unencrypted
mode. A group photo sent in clear would be the first piece of a group the server could
read, so the photo follows the name. Making the picture in the core gives one place where
metadata is stripped, and that is the code every platform already trusts with the keys.
Keeping the object in the photo bucket rather than the media bucket gives it the lifetime
of a picture rather than of a message, with no new bucket and no change to a lifecycle
rule.

## What it rules out

- A group photo the server can read or re-encode.
- A photo on a conversation of two.
- Uploading the original file: only the core's re-encoded square is ever sealed.
- A group photo that expires with the messages, or one that `DELETE /me` removes from the
  other members.
- Roles that limit who may change it.
