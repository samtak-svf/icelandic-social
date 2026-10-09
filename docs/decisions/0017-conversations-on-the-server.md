# 0017. The server keeps a roster per conversation, moved only by a winning commit

- Status: accepted; implemented in the backend. Push goes to FCM and APNs as
  [0025](0025-push-without-ids.md) says. The roster's source, and what `not_a_member` means to a client, are
  amended by [0020](0020-membership-bound-to-commits.md).
- Date: 2026-10-06
- Decided by: Guðröður, approving the plan for the delivery backend
- Amended by: [0025](0025-push-without-ids.md) (the outbox is re-armed and sends one push per device)
- Amends: [0015](0015-delivery-protocol.md) (how members, Welcomes and KeyPackages reach the server)

## Decision

Decision 0015 says how ciphertext is stored and announced. To store it, the server must know
who may post and read in a conversation, and whom to notify. It learns that without reading
any ciphertext.

- **A conversation's id is its MLS group id**, as unpadded base64url. The `Conversation`
  Durable Object reads the group id from each message's unencrypted framing (RFC 9420 §6)
  and refuses one that names another group (`400 group_mismatch`). A ciphertext can then never
  be stored under the wrong conversation, and there is no mapping table to drift.
- **`POST /v1/conversations` creates a conversation** with the caller's account as its only
  member. Sending it again from that account answers the same; from any other account it is
  `409 conversation_exists`.
- **The server keeps a roster of accounts** per conversation, for authorization and fan-out
  only. MLS stays the truth for who can read.
  - Only a member may send, list, read a Welcome or send `typing`; anyone else gets
    `403 not_a_member`.
  - **The roster moves only together with a commit**, in the same send:
    `roster: {add?, remove?}`. The DO applies it only if that commit is the one stored for
    its epoch. A refused commit (`409 epoch_conflict`) changes nothing.
  - The server cannot check that the roster change matches the commit. A member who lies can
    only route ciphertext to an account that cannot decrypt it, or stop notifying one that
    still can; the other members' clients see the true membership in MLS and correct it with
    their next commit.
- **A Welcome travels with the commit that adds its members:** `welcome: {to, message}`, where
  every account in `to` must be a member once `roster` is applied.
  - It is stored at the commit's `seq` and expires with the messages (0015, 30 days).
  - The joining account's devices get a `notify` for a conversation they do not know, call
    `GET /v1/conversations/{conversationId}/welcome` (`{seq, welcome}`), join, and fetch the
    messages after that `seq`.
- **One commit per epoch.** The DO reads `epoch` and the content type from the framing of a
  PublicMessage or PrivateMessage. A commit must be made on the current epoch, the one after
  the last stored commit's; any other is `409 epoch_conflict`. Application messages for older
  epochs are still stored, because a member may send just before seeing a commit.
- **KeyPackages live in D1.**
  - `POST /v1/key-packages` uploads up to 100 for the calling device, plus an optional
    last-resort one, and answers `{available}`, so the client knows when to top up.
  - `POST /v1/accounts/{accountId}/key-packages` claims one per active device of that account,
    consumed in the same statement that reads it. The last-resort package is returned when a
    device has nothing else, and is never consumed.
- **Fan-out cannot be lost.** The message and a pending notification for every member are
  written in one SQLite transaction in the `Conversation` DO, and an alarm delivers them to
  each member's `Inbox`. Delivery moves a maximum, so a retried alarm repeats nothing. An
  account a commit removes is notified of that commit too; its fetch then answers
  `not_a_member`, which is how its devices learn they are out.
- **Push is an outbox.** The `Inbox` writes one row per device and conversation for a device
  with no open socket whose cursor is behind, until that device acks; 0025 re-arms it on
  each newer urgent message. A sender interface drains it; until FCM and APNs are set up, the only sender logs `push.skipped`.
- **Reconnecting catches up.** After `hello`, the `Inbox` sends `notify` for each conversation
  whose latest `seq` is past that device's cursor.

## Why

Routing needs membership, and the only membership the server can see without breaking
end-to-end encryption is the one clients tell it. Tying every roster change to the commit
that carries it, and to that commit winning its epoch, keeps the server's view in step with
MLS without the server reading a commit. Using the group id as the conversation id removes a
whole class of misfiled messages for free.

## Rules out

The server deciding membership on its own; a roster change without a commit; a Welcome
delivered by any path other than its commit; consuming a last-resort KeyPackage; a lost
notification after a stored message.
