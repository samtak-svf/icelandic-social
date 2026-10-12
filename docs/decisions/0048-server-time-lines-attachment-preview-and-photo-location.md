# 0048. Times by the server, a preview before sending, and no location in a picked photo

- Status: accepted; implemented in the backend (#217), the core (#218, core 0.20.0) and the apps
  (#219, #220), released as 0.7.0
- Date: 2026-10-12
- Decided by: the maintainer, after the 0.6.2 hand test, choosing the server's time for the
  time lines
- Amends: [0045](0045-times-between-messages-and-one-reaction-pill.md) (which time a time line
  shows; the late-message line), [0047](0047-the-header-attachments-me-and-new-conversation.md)
  (the preview, and location in a photo)
- Builds on: [0022](0022-the-conversation-surfaces.md) (items are ordered by `seq`),
  [0023](0023-media-as-encrypted-blobs.md) (a photo or file carries an optional caption),
  [0008](0008-no-pii-in-logs.md) (what the server learns)

## Decision

### A row's time is when the server stored it

- **The server returns the time it stored each message**, `storedAt`, in Unix milliseconds by
  its own clock, next to `seq` in the message list. It already keeps it for retention.
- **The core keeps it as the item's `received_at`**, raised to the previous item's when it is
  earlier, so times never go back along `seq`. An edit never moves the time of the message it
  edits. A card (members, timer) takes the time of its commit.
- **Time lines, runs, the time shown on tap, the conversation list and notifications use that
  time.** Order is still `seq` (0022).
- Rows stored before this change have no server time and keep the sender's clock. A message
  still being sent has no server time either, and uses this device's clock, never earlier than
  the row before it.
- **0045's line for a late message is withdrawn.** A message sent offline is shown at the time
  it reached the server, among the messages it arrived with.

### A picked photo or file waits for send

- **A photo from the camera or from "Mynd", or a file from "Skrá", is not sent when it is
  picked.** It waits above the field as a strip: a small picture of the photo, or the file's
  name and size, and a button that removes it.
- **The field's text becomes its caption.** While it waits, send replaces the camera and attach
  buttons, as with text.
- The 25 MB limit is checked when it is picked, not when it is sent.
- Starting a reply or an edit removes a waiting attachment: an edit cannot carry one, and a
  reply with one is not in v1. If sending fails, the attachment and the caption stay for
  another try.
- It survives a rotation. It does not survive the app being stopped by the system, because the
  folder it waits in is emptied at start.

### No location in a picked photo

- **A photo picked through "Mynd" loses its location before it waits**, as a camera photo does
  (0047). Only the metadata is rewritten; the picture is not encoded again. A HEIC photo goes
  as the system picker returns it, which is without location for an app that has not asked for
  it.
- **A file sent through "Skrá" is sent byte for byte.** It is a file, not a photo, and the
  person chose to send exactly it.

### A sent photo stays in view

- While the bottom of the list is in view, it stays in view when the newest row grows, as a
  photo does once it is decoded. Someone reading further up is not moved.

## Why

The 0.6.2 hand test found a photo sent the moment it was taken, with no way to stop it, though
0047 said it went through a preview. It found a sent photo below the fold once it had loaded.
And it found "Laugardagur 23:01" after "Í gær 00:00": a sender's clock is not ordered by
`seq`, so 0045's lines followed it back in time. The server's clock is one clock for everyone
and agrees with `seq`. The server already knows when each message arrived, and every member
already learns it from the notification, so returning it tells nobody anything new.

A location in a picked photo leaks where the person was, as it does in a camera photo.

## Rules out

- Showing both the sender's and the server's time.
- Downloading old messages again to learn their server time.
- Ordering the timeline by any clock.
- Several attachments at once, and an attachment in a reply.
- Encoding a picked photo again to remove its location.
