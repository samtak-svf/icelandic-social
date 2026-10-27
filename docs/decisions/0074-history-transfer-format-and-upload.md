# 0074. A history travels as one sealed file, uploaded in parts and deleted on receipt

- Status: accepted; implemented in the core and the backend (#42); the approve screen not yet
  (#82), the web client not yet (#43)
- Date: 2026-10-21
- Decided by: Guðröður Atli Jónsson
- Amended by: [0081](0081-the-browser-runs-the-blocking-core-in-a-worker.md) (a ranged
  download), [0108](0108-the-socket-says-when-it-has-caught-up.md) (asked for until it comes)
- Builds on: [0064](0064-non-phone-devices-are-linked-devices.md) (history from the approving
  phone), [0023](0023-media-as-encrypted-blobs.md) (media and their segments)

## Decision

### The file

- **One file: `SPJH`, a version byte, the HPKE encapsulation, then a sealed stream.** HPKE
  base mode with DHKEM(X25519, HKDF-SHA256), HKDF-SHA256 and AES-256-GCM, to the one-time
  X25519 key from the link's QR code, exports a 32-byte key; the body is sealed with it in
  the media segment format of 0023 (64 KiB AES-GCM segments whose nonce carries the index and
  a last-segment flag). One-shot HPKE cannot stream a gigabyte, and the media format already
  refuses a stream that is cut short, reordered or spliced.
- **The plaintext is the store's own records**: the conversations, their timelines,
  reactions, read state and the profiles they show, then media bodies newest first while the
  whole stays within 1 GiB. Media past that travel as references (0023). Nothing else the
  phone holds (its MLS state, keys, settings) is in it.
- **Import is all or nothing and idempotent.** A file that is not whole adds nothing, and the
  same file twice adds nothing the second time.

### The upload

- **The phone uploads in parts the server names.** `POST …/history` with the sealed size
  returns the part size (64 MiB) and the count; `PUT …/history/parts/{n}` takes exactly each
  part's length; `POST …/history/complete` joins them. A Worker request body is far smaller
  than a gigabyte, so the parts go into R2 multipart in the existing EU media bucket under
  `history/<linkId>`. No new resource.
- **Only the phone that approved the link uploads**, once per link, within 24 hours of the
  approval. **Only the device the link made downloads.** Either may delete it.
- **The device deletes it once it has imported it**, not once it has downloaded it: a
  download that breaks, or a file that does not open, can be tried again until the 24 hours
  end. The minute cron deletes every transfer past 24 hours, and a 1-day lifecycle rule on
  `history/` is the backstop behind it.
- **The core drives both ends** (`send_history`, `receive_history`), so the phone, the
  browser and a desktop share one implementation; the apps only choose what to send (90
  days, everything, or nothing) and show progress.

## Why

The server must carry a gigabyte it cannot read, for a day at most, from a Worker that takes
far smaller bodies. Reusing the media segments means no new cipher construction to review;
reusing the media bucket means no new resource and no new jurisdiction to get right.

## What it rules out

- A history sealed to anything but the link's one-time key, or a key the server holds.
- Sending history after linking, or to a device the phone did not approve.
- Keeping a history on the server past 24 hours, or after the device has it.
