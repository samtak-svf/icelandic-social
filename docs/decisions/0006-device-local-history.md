# 0006. History is device-local; a new device sees only future messages

- Status: accepted
- Date: 2026-10-05
- Decided by: Guðröður (plan), recorded at phase 0

## Decision

- Decrypted messages are stored **only on the device** that decrypted them, in the app's
  SQLite store (Room / GRDB) in the shared app container. The server keeps ciphertext only
  until its retention TTL (decision 0002).
- A **new device** joins each conversation through MLS (Welcome, or an external join from the
  stored GroupInfo) and sees **messages from that point on**. Every member sees a "new
  device" system card, derived from the MLS add commit, so a silent extra reader is visible.
- **Cross-process rule**: the app and its notification extension / messaging service share
  one store in the App Group container (iOS data protection
  `completeUntilFirstUserAuthentication`, store key in the Keychain with `AfterFirstUnlock`)
  behind a cross-process file lock with a **single writer**. Whichever process decrypts a
  message writes its plaintext; MLS decryption advances the ratchet and cannot be repeated,
  so the other process only reads.
- Key and history **backup** is a later decision record, not v1.

## Why

With end-to-end encryption, server-side history would be either readable by the server or a
second key-management system. Device-local history is what MLS gives for free; making the
consequence visible (the card, and copy saying a new phone starts empty) is cheaper than
users discovering it.

## Rules out

Server-side message history; silently adding devices; two processes each decrypting the
same message.
