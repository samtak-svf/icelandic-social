# 0015. What persists goes over REST; the WebSocket carries only what is live

- Status: accepted; implemented in the Worker and the core. Push goes to a sender that only
  logs until FCM and APNs are set up.
- Date: 2026-10-06
- Decided by: Guðröður, approving the plan that acted on the phase-0 review
- Amended by: [0017](0017-conversations-on-the-server.md) (the roster, Welcomes and KeyPackages)

## Decision

**REST carries every message the server stores.** It has generated clients on both
platforms (decision 0005), and each call is idempotent and testable on its own.

- `POST /v1/conversations/{conversationId}/messages` takes `{clientMsgId, ciphertext}` and
  answers `{seq}`.
  - Sending the same `clientMsgId` again answers the same `seq`.
  - A commit for an epoch that already has one is refused with `409 epoch_conflict`, and its
    sender re-proposes on the new epoch (decision 0002).
- `GET /v1/conversations/{conversationId}/messages?after=<seq>&limit=<n>` answers the stored
  ciphertexts after `seq`, oldest first, with `more` when there are more.
- `GET /v1/ws` upgrades to the WebSocket, with the device token (decision 0014).

**The WebSocket carries only frames that are not stored.** They form one union tagged by
`type` (`WsFrame`, decision 0005):

| Frame    | Direction        | Meaning                                                 |
| -------- | ---------------- | ------------------------------------------------------- |
| `hello`  | server to client | first frame: protocol version and server time           |
| `notify` | server to client | a conversation has messages up to `seq`; fetch them     |
| `ack`    | client to server | this device has stored everything up to `seq`           |
| `typing` | both             | an encrypted typing indicator, relayed and never stored |
| `ping`   | both             | keepalive, answered with `pong`                         |
| `pong`   | both             | the answer to `ping`                                    |

- **Typing is its own frame type** so the Durable Object can tell, without reading any
  ciphertext, that it must forward and never store it (decision 0009). Inside the ciphertext
  is the envelope's `typing` kind, as for every other kind.
- **`ack` moves this device's cursor** in the account's `Inbox` (decision 0014). A push (the
  fetch hint `{conv, seq}`, decision 0002) is sent only for a device whose cursor is behind
  and which has no open socket.
- **Retention:** the `Conversation` Durable Object deletes stored ciphertext 30 days after it
  was stored, with an alarm. A device offline for longer misses those messages and sees a
  system card saying so.
- Binary data is base64 text in both REST and WebSocket bodies.

## Why

Sending over REST and listening on the socket keeps the stored path in the generated,
retried, idempotent clients, and leaves the socket a thin notification channel that may
drop at any time without losing anything. A frame type for typing is cheaper and safer than
a flag the server would have to trust.

## Rules out

Sending messages over the WebSocket; message content in a push payload; the server
storing a typing indicator; the server reading a frame's ciphertext to decide what to do
with it; unbounded retention.
