# 0069. On the web, Kenni adds the mark to a signed-in account and is never a way in

- Status: accepted; implemented in the backend and the web (#72)
- Date: 2026-10-19
- Decided by: Guðröður Atli Jónsson
- Builds on: [0035](0035-google-only-sign-in-and-merge-on-kenni.md) (everyone signs in with
  Google; Kenni vouches for the person and joins an older account),
  [0061](0061-account-identity-session-and-device-are-separate.md) (the browser session)
- Amends: [0062](0062-the-web-host-and-its-sign-in-callbacks.md) (the Kenni web client was
  wired as a sign-in callback)

## Decision

0035 took Kenni off the apps' sign-in screen: every person signs in with Google, and Kenni
does one thing, vouching for the person behind that sign-in. 0062 then gave the web a Kenni
callback of its own, and the web's first build offered it as a second way in, so a browser
could make an account that holds Kenni and no Google. On the web, Kenni now does what it does
in the apps.

- **The web sign-in screen offers only Google.** Its Kenni button and the hint comparing the
  two go.
- **`/auth/kenni/start` needs a signed-in browser session.** Without one it answers `401`
  and starts no flow. The flow cookie seals the session's id, and the callback acts only for
  the same live session.
- **The Kenni callback links, by 0035's rules.** It links Kenni to the session's account,
  which then carries the mark and the registry's name. When the kennitala already holds an
  older account without Google, the account joins into it as `POST /v1/me/identities` with
  `merge: true` joins one, and the browser's session moves with it. The callback never makes
  an account.
- **The callback returns to the path it was started for**, with `verify=linked`, `merged` or
  `taken` in its query, so the page says what happened.
- **A join moves the calling session, a phone's or a browser's.** Until now a joined phone
  kept its device and lost its session, which went with the deleted account and was healed
  as a new one on the next request.
- **Ég and settings on the web offer "Fá staðfestingarmerki"** for an account without the
  mark, as the apps do.

Nothing else in 0062 changes: the client `@innskraning.is/spjall-web`, its secret and its
callback path stay as registered.

## Why

- One way in is what 0035 decided, and the web is a client like the apps: a person who
  signs in on the web with Kenni and on a phone with Google would otherwise hold two
  accounts.
- A link needs the account it links to. Tying the flow to the session that started it keeps
  one browser from adding the mark to another browser's account.
- Production held no account with Kenni and without Google when this was decided (0 of 6,
  2026-10-19), so no account needs moving.

## Rules out

- Kenni as a way in on any client.
- A Kenni flow started without a session, or finished in a session other than its own.
