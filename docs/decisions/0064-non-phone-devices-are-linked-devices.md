# 0064. A device that is not a phone is linked from a session and approved on a phone

- Status: accepted; implemented in the core seams, the backend enrolment and history from a
  sibling device (#298, #299, #300; the format and upload are 0074); the web client not yet (#301)
- Date: 2026-10-17
- Decided by: Guðröður Atli Jónsson
- Builds on: [0002](0002-mls-end-to-end-encryption.md), [0014](0014-accounts-devices-and-auth.md)
  (a device and its token), [0021](0021-group-info-and-external-join.md) (joining by
  external commit), [0028](0028-removing-a-device-from-its-groups.md) (removing a device's
  leaves), [0061](0061-account-identity-session-and-device-are-separate.md) (sessions),
  [0062](0062-the-web-host-and-its-sign-in-callbacks.md) (the web host)
- Amended by: [0074](0074-history-transfer-format-and-upload.md)
- Amends: 0006 (a linked device may receive history from the phone that approved it), 0016
  (the store in a browser)

## Decision

### Linking

- **A browser or desktop client becomes an MLS device only by linking.** It is signed in to
  a session first (0061), which never makes it a device. Linking is a separate step the
  person starts on that client.
- **A phone of the same account approves it.** The new client makes its device key and shows
  a QR code holding the link request's id, its public key and a one-time X25519 key for the
  history transfer. The phone scans it, shows the client's label from its session, and on
  approval signs the new device's key with its own device key. The server enrols the device
  (0014) only with that signature from an active phone of the account. An account with no
  phone cannot link a device.
- The linked device joins each conversation by external commit (0021), and every member sees
  the "new device" card (0006). A linked device is listed with its kind on the account's
  device list, and can be revoked from any device of the account.

### Lifetime

- **A linked device is removed after 45 days without use.** The server revokes a linked device
  that has made no authenticated request in 45 days, and its leaves are removed as 0028 says.
  A phone is never removed for inactivity.
- **It also ends with the session that linked it** (0061): signing out of that browser or
  desktop revokes the device.

### History from the approving phone

- **The phone may send its history to the new device**, once, at linking, if the person
  chooses: the last 90 days or everything. It is encrypted on the phone to the one-time X25519
  key from the QR code (HPKE), so the server carries a blob it cannot read.
- **The server holds the blob in R2 in the EU at most 24 hours**, and deletes it once the
  device has downloaded it. A transfer is at most 1 GiB; media past that limit stay on the
  phone and are fetched again by their reference, if the media object still exists (0023).
- A phone that replaces another phone still starts empty, as 0006 says. Moving history between
  phones is a later record.

### The store in a browser

The measurement ([`docs/browser-storage.md`](../browser-storage.md), #297) sets these:

- **The core's own store, with SQLite3 Multiple Ciphers in OPFS** (`opfs-sahpool`), in a
  dedicated worker. It is the same schema as on a phone with a different file system, and the
  store refuses to open without a cipher (#265).
- **One tab owns the store**, chosen with a Web Lock on the store's name. The other tabs talk
  to it over a `BroadcastChannel`, or say the chat is open in another tab.
- **The store key has two parts.** 32 random bytes are the store's key. They are sealed by a
  non-extractable AES-GCM `CryptoKey` kept in IndexedDB, and the sealed bytes are sealed again
  by a 32-byte secret the server keeps for that device and hands only to its live session.
  Script on the page cannot export the local key, and a copied browser profile opens nothing
  without a live session. Neither part alone opens the store, so the server's part is not a
  key backup.
- **Ending the device or its session destroys it.** The server deletes its part first, the
  client then deletes the key database and the files, and the server answers the request that
  ends the session, and any later one from it, with `Clear-Site-Data: "storage"`, the one wipe
  the measurement found complete in every engine.
- **The store is a cache.** Browsers evict storage (Safari after 7 days without a visit), so a
  browser that finds its store gone is a lost device: it is revoked, and the person links again.
- **Browser chat waits for the async core.** The browser client's transport is not the
  phones' blocking one; that is the first engineering decision of phase 6 (#308), before any
  chat in a browser.
- A desktop app, when there is one, uses the native core, SQLCipher and the OS keychain, and
  links the same way.

### The code that runs

- **Every script, style and wasm module is served from the web host** with Subresource
  Integrity, under a Content Security Policy that allows only the host's own scripts (and
  `wasm-unsafe-eval` for the core). No third-party script runs on the origin.
- **Every web build publishes its file hashes** in its GitHub release, built from its tag, so
  anyone can compare what the host serves with what was built.

## Why

- A phone is where the person's keys already live under hardware protection. Approving on it
  gives a linked device a root of trust the person can see, and a stolen session cannot add a
  reader to their conversations without their phone.
- A browser's key protection is the weakest of any client. The two-part key and the 45-day
  removal bound what a forgotten or copied browser can expose.
- History from a sibling is what makes a linked device useful (an established messenger
  does the same since 2025), and encrypting it to a one-time key keeps 0002's promise: the server never holds
  readable history or a key that opens it.
- One store design across clients means the browser runs the core's own schema and tests, not
  a second implementation.

## Rules out

- MLS enrolment as part of signing in, or linking without a phone's approval.
- A server-side backup of history or of a key that opens it alone.
- A store key kept unsealed, or in `localStorage`, `sessionStorage` or a cookie.
- A second storage implementation for the browser.
- A third-party script on the web host, or a script served without SRI.
- Inactivity removal for phones.
