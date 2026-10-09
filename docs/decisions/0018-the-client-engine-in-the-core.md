# 0018. The core runs the client: one sync engine over a transport the apps provide

- Status: accepted; registration amended by [0019](0019-sign-in-and-invites.md), what
  `not_a_member` means by [0020](0020-membership-bound-to-commits.md), and joining and the
  stale state by [0021](0021-group-info-and-external-join.md): a new device of a member
  account joins, and a stale one rejoins, by external commit
- Date: 2026-10-06
- Decided by: Guðröður, approving the plan for the MLS client
- Builds on: [0002](0002-mls-end-to-end-encryption.md), [0006](0006-device-local-history.md),
  [0015](0015-delivery-protocol.md), [0016](0016-one-encrypted-store-owned-by-the-core.md),
  [0017](0017-conversations-on-the-server.md)
- Amended by: [0028](0028-removing-a-device-from-its-groups.md) (device-level group changes)

## Decision

Decisions 0015 and 0017 say what the server stores and refuses. This one says how a device
uses it without ever losing, repeating or forking anything.

### Who does what

- **The core drives sync; the apps move bytes.** The core defines a blocking `Transport` with
  one method: make this HTTP request (a method, a path under `/v1/`, a JSON body) and return
  the status and body, or say that no answer came. The app adds its base URL and device token.
  The paths, bodies and `ApiError` codes of `api/openapi.json` are then written once, in Rust,
  and an app's transport is a dozen lines over OkHttp or URLSession. The apps own the WebSocket, because
  its life follows the app's, and hand each frame to the core, which answers with the frames
  to send back (`ack`). Every call may block on the network, so the apps call the core off the
  main thread.
- **No network call runs inside a store transaction.** A transaction reads, decides, and
  writes; the network happens between transactions. Because every transaction re-checks the
  state it acts on, two processes sharing the store (the app and its notification extension, 0016) can sync at the same time: the second finds the work done and does nothing.

### Identity

- A device's **MLS credential is a `BasicCredential` whose identity is the ASCII
  `{accountId}/{deviceId}`**, and its signature key is the Ed25519 device key registered with
  `POST /v1/devices` (0014). Both ids match `^[A-Za-z0-9_-]{1,128}$`, so the `/` is
  unambiguous. Every leaf thus names its account and device, which is how a client turns a
  group into a list of accounts and a message into a sender.
- The core creates the key pair before registration and gives the app the public key; the app
  tells the core its ids once the server has answered.
- **A KeyPackage must name the device that uploads it.** The server refuses one whose leaf
  credential is not the uploader's `{accountId}/{deviceId}` or whose signature key is not that
  device's key, and a client refuses a claimed one whose credential does not name the account
  and device it was claimed for. Otherwise a claimer could be handed a key the account never
  registered.
- A claim does not return the caller's own device: it is the one device that is already in
  the group, or creating it.

### Membership

- **One device is one leaf.** Adding an account adds every active device it has, from one
  claim, in one commit, with one Welcome. Removing an account removes all its leaves.
  Creating a conversation adds the creator's other devices in its first commit.
- The roster sent with a commit (0017) is derived from that commit: the accounts it adds, and
  the accounts it removes the last leaf of.
- Group config: the pinned ciphersuite, the ratchet tree in the Welcome (so a Welcome alone
  joins), and `max_past_epochs = 5`, because the server stores application messages made on
  an epoch that a commit has just ended (0017).

### The outbox

- **Everything a device sends is a row in the outbox first**, written in the transaction that
  records the user's intent: a message, creating a conversation, adding or removing accounts.
  Rows of one conversation are sent in order.
- **A row is sealed once and then sent as the same bytes until it resolves.** Sealing
  encrypts a message, or builds a commit and its Welcome, in one transaction that also stores
  the ciphertext and a fresh `clientMsgId` on the row. A retry, after a lost response or a
  process that died, resends exactly those bytes, and the server answers the first `seq`.
  Encrypting again would burn ratchet generations and defeat the server's idempotency.
- **A row is sealed only when the conversation has no own commit in flight.** A sent commit
  is merged when the fetch reaches its `seq`, so the messages other members posted before it
  are read on the epoch they were made on. Receiving never runs past an own commit that is
  not resolved.
- **A commit refused with `409 epoch_conflict` is unsealed, not dropped.** Its pending commit
  is cleared, the conversation catches up, and the intent behind it (add or remove these
  accounts) is sealed again on the new epoch; an add claims KeyPackages again, because the
  first ones are spent.
- **An own message is recognised by the `seq` its row was given**, never by trying to decrypt
  it, which MLS refuses.

### Receiving

- A fetch processes each message in its own transaction that advances the conversation's
  cursor, so a message is decrypted exactly once and **its plaintext is stored in the same
  transaction that decrypted it** (0006): a process that dies loses nothing and repeats
  nothing.
- A `notify` for an unknown conversation fetches its Welcome, joins, and reads on from the
  Welcome's `seq`.
- `403 not_a_member` marks the conversation **removed**. A gap in `seq` (messages expired
  before this device read them, 0015) or a message on an epoch the device no longer holds
  marks it **stale**: it is shown read-only until rejoining exists.
- Each call returns events for the app: messages, membership changes, conversations joined,
  removed or stale.

### Typing

- **Typing does not use the message ratchet.** A typing indicator is not stored, so a
  member who misses one would have to skip its ratchet generation, and a burst of them would
  push a stored message out of the window the ratchet keeps for late arrivals. Instead it is
  sealed with AES-128-GCM under a key exported from the current epoch (RFC 9420 §8.5,
  label `spjall typing`). Any member can produce one, so its sender is a claim, not a proof;
  for a typing indicator that is enough.

## Not in this decision

A new device of an existing account joining that account's groups; rejoining a stale
conversation from its stored GroupInfo; removing a device the server no longer serves
([0028](0028-removing-a-device-from-its-groups.md)); leaving a group; updating one's own leaf for
post-compromise security; attachments. Each gets its own decision when it is built.

## Why

The rules that keep a group from forking are subtle, and getting them wrong once on a phone is
a conversation that can never be read again. Writing them once, in Rust, tested against a
relay that enforces the server's rules and against the real Worker, beats writing them twice
in Kotlin and Swift. Sealing once and sending the same bytes turns every network failure into
a retry, which the server already makes harmless.

## Rules out

Sync logic in the apps; a network call holding the store's write lock; re-encrypting a
message to retry it; a commit sent while another own commit is unresolved; decrypting a
message without storing what it said; typing indicators on the message ratchet.
