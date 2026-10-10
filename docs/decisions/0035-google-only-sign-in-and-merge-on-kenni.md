# 0035. Everyone signs in with Google; Kenni joins a Google sign-in to the account it verifies

- Status: accepted; implemented in the backend (#141), the core (#142, 0.12.0) and the apps (#144)
- Date: 2026-10-10
- Decided by: the maintainer, reviewing the sign-in flow on a phone
- Builds on: [0021](0021-group-info-and-external-join.md) (a device joins by external commit),
  [0028](0028-removing-a-device-from-its-groups.md),
  [0033](0033-google-sign-in-and-kenni-verification.md)
- Amends: 0014 (a token lives until its device is revoked or its account deleted), 0033
  (Kenni as a secondary way in on the sign-in screen; merging accounts ruled out)

## Decision

0033 kept "Skrá inn með rafrænum skilríkjum" on the sign-in screen so that the accounts made
before it, all of them Kenni accounts, stayed reachable on a new device. That makes two ways
in and leaves open which Google account belongs to which person. From here every person signs
in with Google. Kenni does one thing: it vouches for the person behind the Google sign-in. When
the kennitala already holds an older account, Kenni joins the Google sign-in to that account.

### The sign-in screen

- **The apps offer only "Halda áfram með Google".** The Kenni button and its string go.
- **The Worker still takes a Kenni code at `POST /v1/devices`**, for app builds at the current
  floor (0030). It goes when the floor passes the first build without the button.

### Linking Kenni joins the two accounts

`POST /v1/me/identities` with a Kenni code whose kennitala another account holds is
`409 identity_taken` today. It now joins the two, under these conditions:

- **The client asks for it**, with `merge: true` in the body. A client without it gets the 409
  as before, so a build that cannot follow the move is never moved.
- **The calling account holds a Google identity and no Kenni identity, and the account holding
  the kennitala holds no Google identity.** Kenni then proves one person is behind both, and
  the result holds one identity per provider (0033). If the older account already holds a
  Google identity, the kennitala's owner signs in with another Google account, and the answer
  stays `409 identity_taken`.
- **The older account is the one kept.** It already holds the person's conversations, other
  devices and verified name.

What moves, in one D1 transaction:

1. the Google identity, to the older account;
2. the calling device, with its device id and token unchanged; its KeyPackages are deleted,
   because their credentials name the account it leaves;
3. the calling account's posts and replies, its reactions where the older account has none on
   that post, and its blocks of accounts other than the older one;
4. the older account's name and mark, refreshed from the registry as any Kenni link does.

Then the calling account is deleted as `DELETE /v1/me` deletes one (0014, 0019): its other
devices' tokens fail at once, it leaves its conversations, and its Inbox and media go. Its
other devices sign in with Google again and land on the older account. The answer is
`200 {accountId}`, the account the device now belongs to.

- **The device starts on the older account as a new device of it.** The core keeps its device
  key, empties its conversations, history, outbox, names and blocks, which belonged to the
  account that is gone, and stores the new account id. The older account's conversations take
  it in by external commit (0021). The apps restart the signed-in session, as after a sign-in.
- **The calling account's conversations are not carried over.** MLS credentials name an
  account, and the other members agreed to that account, not to another. Its 1:1s end as a
  deleted account's do (0028). An account made by a Google sign-in a moment before Kenni has
  none, which is the case this is built for.
- **An account left without an identity is deleted by the daily cron.** If the deletion fails
  part way, the calling account is left with no identity and no device, and no sign-in can
  reach it. Every account is created with an identity in one transaction (0033), and no route
  removes the last one, so an account without one is always such a leftover.

## Why

One person, one account. A Google account says little about who holds it; the registry says
who the person is. Joining at the moment Kenni proves both are one person gives the older
accounts a way forward that needs no second sign-in method, and lets the server know which
person holds each Google identity. Keeping the older account keeps what other people already
share with it.

## Rules out

- A sign-in with Kenni from the apps.
- Joining two accounts without a Kenni proof, or two accounts that each hold a Google identity.
- Carrying a conversation, or a message, from one account to another.
- Moving a device to another account for a client that did not ask for it.
