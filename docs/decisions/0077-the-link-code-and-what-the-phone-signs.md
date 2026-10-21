# 0077. The link code and what the phone signs

- Status: accepted; implemented in the core and the backend (#82); the apps' scanner and
  approve screen not yet (#82), the web client that shows the code not yet (#43)
- Date: 2026-10-21
- Decided by: Guðröður
- Amends: [0064](0064-non-phone-devices-are-linked-devices.md) (the QR code's contents and
  the approval signature)

## Decision

- **The link code** a browser shows as a QR code is plain text:
  `SPJL1.<linkId>.<deviceKey>.<historyKey>`, the two keys in unpadded base64url, each 32
  bytes. `SPJL1` is the format's version; any other prefix, a missing or extra field, a bad
  base64 or a key of another length is not a link code. It is not a URL, so a phone's own
  camera app does not open it in a browser; only the app's scanner reads it.
- **The core parses it**, once, for every client (`spjall_client::LinkCode`): the phones
  through the FFI and the browser through the wasm core use the same parser and its tests.
- **The phone checks the server against the code.** Before it signs, it fetches the link
  request and refuses it when the server's `deviceKey` or `historyKey` differs from the
  code's, so a server cannot swap the key the person approves on the screen in front of them.
- **What the phone signs** is `"spjall device link v1\0" || linkId (UTF-8) || deviceKey`,
  with its own MLS signature key (Ed25519), the key the server holds for that device. The
  label separates it from every MLS signature, and the link id binds it to one request: a
  signature cannot be replayed onto another link.
- **A link request is approved once.** A second approve, by the same phone or another,
  answers 409 `already_approved` and changes nothing.
- **The history slice is the person's choice on the phone**: the last 90 days, everything, or
  nothing. The app computes `since` from the clock; nothing sends no history at all.

## Why

0064 named the code's three fields but no encoding, and had the phone sign the bare device
key. That signature said nothing about which request it approved, and nothing kept it from
being taken for a signature over some other 32 bytes. Nothing called approve yet, so the
signed message could change without breaking a client.

## What it rules out

- A URL or deep link as the code, which a camera app would open outside the app.
- Signing any bytes the FFI passes in: the core builds the message itself.
- Approving a request the phone has not checked against the code it scanned.
- Re-approving a link to change who approved it.
