# 0016. One encrypted store, owned by the core, shared with the extension

- Status: accepted
- Date: 2026-10-06
- Decided by: Guðröður, approving the plan that acted on the phase-0 review
- Supersedes: 0006's "Room / GRDB" and its separate file lock; 0004's two database files

## Decision

- **One SQLite file, `spjall.db`**, holds both the MLS state and the decrypted history. Only
  the Rust core (`core/store`) opens it, on both platforms and in both processes: the app,
  and its notification service extension (iOS) or messaging service (Android). There is no
  Room or GRDB store and no second database file.
- **Where it lives:** on iOS in the App Group container (`appGroup` in
  `identifiers/ids.json`), excluded from backup; on Android in `noBackupFilesDir`.
- **Decrypt-and-store is one transaction.** The core decrypts, advances the MLS state and
  writes the plaintext inside one `BEGIN IMMEDIATE` transaction (`Store::write`). SQLite's
  write lock is the cross-process single-writer lock that 0006 asks for. The process that
  commits the ratchet advance is the one that wrote the plaintext, and the other process,
  waiting on the lock, finds the message already stored. Two processes each decrypting the
  same message cannot happen.
- **Encrypted with SQLCipher** (`rusqlite` with `bundled-sqlcipher-vendored-openssl`, so
  both platforms get the same SQLCipher and OpenSSL). The key is 32 random bytes made on the
  device when the store is first created:
  - **iOS:** a Keychain item with `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, so
    the extension can read it while the phone is locked and it never moves to another device.
    Its access group is the App Group both targets already carry (`keychainAccessGroup`
    equals `appGroup`; interim builds use `appleInterim.appGroup`), which iOS accepts as a
    Keychain access group without a separate entitlement.
  - **Android:** wrapped by an AES key in the Android Keystore, and the wrapped bytes kept in
    `noBackupFilesDir`.
  - A wrong or lost key fails to open the store. Without key backup (0006) that means
    starting empty, like a new device.
- **`identifiers/ids.json`** has one `store.databaseFile`, `spjall.db`. No build has shipped,
  so nothing migrates.

## Why

With two stores, decrypt-then-store cannot be atomic across processes, and each platform
would carry its own migration system. One file behind the core's own migrations gives one
lock, one schema and one test suite for both apps. The OS file encryption alone leaves the
file readable to anything that gets a copy of the unlocked container; SQLCipher does not.

## Rules out

Room or GRDB for history; a second database file; plaintext SQLite on the device; a key
stored next to the file in the clear; a key that only exists after the user unlocks the
phone once more (the extension must read it while locked).
