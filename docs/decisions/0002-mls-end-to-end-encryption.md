# 0002. Messages are end-to-end encrypted with MLS from v1

- Status: accepted
- Date: 2026-10-05
- Decided by: Guðröður

## Decision

1:1 and group conversations use **MLS (RFC 9420)** through OpenMLS in a Rust core shared by
both apps (`core/`, exposed with UniFFI). One ciphersuite is pinned:
`MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519`. The envelope around an MLS message carries a
version field and tolerates unknown `kind`s, so the suite or envelope can move later
without breaking old clients (`minClientVersion` from `/health` forces the upgrade).

The backend is the MLS **delivery service** and never holds a key that decrypts content. The
`Conversation` Durable Object enforces:

- a monotonic `seq` per conversation;
- **exactly one commit per epoch**: the first commit for epoch _n_ wins, a later one is
  rejected and its sender re-proposes on the new epoch (the epoch is in the unencrypted MLS
  framing, so the DO decides without decrypting);
- idempotent sends by `clientMsgId`;
- storage of the latest GroupInfo and ratchet tree, so a new device can join externally
  when no other device of the user is online;
- a retention TTL on stored ciphertext (alarms).

KeyPackages are consumed once on fetch; each device keeps one last-resort KeyPackage and is
told to replenish under a threshold. Welcome messages are routed by the `Inbox` DO to the new
member's devices.

Push carries a **fetch hint only** (`{conv, seq}`); the notification extension (iOS) or
messaging service (Android) fetches and decrypts on the device. The APNs fallback text shown
when decryption times out is a fixed brand string that never names the sender.

## Why

A messenger that is meant to be trusted with ordinary Icelanders' conversations cannot read
them. Doing it later means migrating every conversation; doing it from v1 costs the core
crate and the delivery rules above, which phase 1 builds and tests across two real core
instances through the real DO.

## Rules out

Server-side search or moderation of 1:1 and group content (reports upload the decrypted
messages from the reporting device, with MLS sender authentication); push payloads with
content; storing MLS state in the Keychain (it lives in the core's SQLite store, decision
0006). Large public groups are not MLS (decision 0007). `ITSAppUsesNonExemptEncryption` is
`YES` on iOS.
