# 0023. Photos and files are encrypted blobs in R2, bound to a conversation

- Status: accepted; implemented in the backend (#56) and the core (#58); the apps send and
  show it since #64 and #67
- Date: 2026-10-07
- Decided by: the maintainer, approving the plan for the conversation UI
- Builds on: [0001](0001-eu-storage-and-residency-wording.md) (EU storage),
  [0002](0002-mls-end-to-end-encryption.md), [0014](0014-accounts-devices-and-auth.md)
  (what `DELETE /me` removes), [0015](0015-delivery-protocol.md) (retention),
  [0018](0018-the-client-engine-in-the-core.md) (attachments were left out of it)

## Decision

0009 puts photos and files in v1. `Body::Media` already exists in the envelope, and the R2
bucket `spjall-media` is in `wrangler.jsonc`, but nothing writes to it.

- **The core encrypts every file before it leaves the device**, with a fresh random
  AES-256-GCM key per file. The file is sealed in 64 KiB segments, each with its own tag and
  a nonce made from the segment number and a last-segment flag, so a file is encrypted and
  checked as a stream and a truncated or reordered blob fails.
- **The key travels only inside MLS.** `Body::Media` carries the object id, the type, the
  size, the key and the SHA-256 of the ciphertext, plus an optional caption and an optional
  file name. The server sees an opaque blob of a known size. The name is what the sender's
  device called the file; the receiving core cuts it to its last path component without
  control characters before any screen sees it, so an app can name a copy with it.
- **An object belongs to one conversation.**
  - `PUT /v1/conversations/{conversationId}/media/{mediaId}` takes the ciphertext from a
    device whose account is in that conversation's roster; `mediaId` is 128 random bits
    chosen by the core. The Worker streams it to R2 and refuses more than 25 MB
    (`413 too_large`) or an id already used (`409 conflict`).
  - `GET` on the same path answers only to an account in the roster (`403 not_a_member`).
    A removed member cannot fetch what was sent after, or before, they left.
  - D1 keeps a row per object (id, conversation, uploader account, size, time), which is
    what makes expiry and account deletion possible without listing the bucket.
- **Objects expire after 30 days**, the retention of messages (0015). A scheduled Worker
  deletes the expired rows and their objects. An R2 lifecycle rule on the bucket is the
  backstop; creating it is the owner's step, with the bucket.
- **`DELETE /me` deletes the account's objects**, as 0014 already says, from the D1 rows.
- **The apps pass file paths, never bytes, across the FFI.**
  `send_media(conversation, path, mime, caption, name)` reads, encrypts and uploads in a stream
  through a new bytes body on `Transport`. `media(conversation, seq)` downloads, checks the
  SHA-256, decrypts into the store's own media folder and returns the path, which the app
  shows with its own image loader or file preview. The disappearing purge (0022) deletes
  these files with their rows.
- **No log line carries a media id together with an account id** (0008).

## Why

A media key inside MLS gives photos the same protection as text with no second key system.
Binding an object to a conversation lets the server answer a fetch with the same roster check
it already makes for messages, so a leaked id alone is not enough. Segmented encryption keeps
a 25 MB file out of memory on both platforms. A D1 row per object costs little and is the only
way to delete one person's uploads without scanning the bucket.

## Rules out

Unencrypted uploads; a media key outside MLS; an object any signed-in device can fetch;
bytes of a whole file across the FFI; keeping an object longer than its messages.

## Known limits

Thumbnails are not separate objects in v1: a photo is downloaded whole before it shows. A
member who has downloaded a file keeps it until the timer or they delete it.
