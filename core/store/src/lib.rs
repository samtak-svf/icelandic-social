//! The core's one SQLite file (decision 0016): MLS state and decrypted history
//! together, encrypted with SQLCipher, opened only through this crate by the
//! app and by its notification extension or messaging service.
//!
//! Decrypt-and-store is one `BEGIN IMMEDIATE` transaction (`Store::write`).
//! SQLite's write lock is the single-writer lock across processes, so the
//! process that advances a ratchet is the one that stores the plaintext.
//! `spjall_mls::storage` keeps the OpenMLS state in `kv`; the client engine
//! (decision 0018) keeps its account, conversations, history and outbox in
//! the tables of migration 2.

use std::path::{Path, PathBuf};
use std::time::Duration;

pub use rusqlite;
use rusqlite::{Connection, Transaction, TransactionBehavior};

/// `store.databaseFile` in `identifiers/ids.json`; a test holds them equal.
pub const FILE_NAME: &str = "spjall.db";

/// The SQLCipher key: 32 random bytes the platform keeps (Keychain on iOS,
/// wrapped by the Android Keystore on Android).
pub type Key = [u8; 32];

/// How long a write waits for the other process to finish its own.
const BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Applied in order, once each, inside one transaction. Append only: an
/// applied migration is never edited, because devices already ran it.
const MIGRATIONS: &[(u32, &str)] = &[
    (
        1,
        "CREATE TABLE kv (
             key   BLOB PRIMARY KEY,
             value BLOB NOT NULL
         ) STRICT, WITHOUT ROWID;",
    ),
    (
        2,
        // Decision 0018. Lists of account ids are one per line: an id never
        // holds a newline.
        "-- This device: its key from the moment it is made, and the account
         -- and device ids once the server has registered it.
         CREATE TABLE account (
             id         INTEGER PRIMARY KEY CHECK (id = 1),
             device_key BLOB NOT NULL,
             account_id TEXT,
             device_id  TEXT,
             CHECK ((account_id IS NULL) = (device_id IS NULL))
         ) STRICT;

         -- Every group this device is or was in. `new` until the server
         -- has it; `cursor` is the last seq processed, so a fetch asks for
         -- what comes after it.
         CREATE TABLE conversations (
             group_id   BLOB PRIMARY KEY,
             state      TEXT NOT NULL DEFAULT 'active'
                        CHECK (state IN ('new', 'active', 'removed', 'stale')),
             cursor     INTEGER NOT NULL CHECK (cursor >= 0),
             created_at INTEGER NOT NULL
         ) STRICT, WITHOUT ROWID;

         -- Decrypted history (0006): each envelope is stored in the
         -- transaction that decrypted it, or for an own message, the one
         -- that saw its seq come back.
         CREATE TABLE messages (
             group_id       BLOB NOT NULL
                            REFERENCES conversations (group_id) ON DELETE CASCADE,
             seq            INTEGER NOT NULL,
             sender_account TEXT NOT NULL,
             sender_device  TEXT NOT NULL,
             envelope       BLOB NOT NULL,
             stored_at      INTEGER NOT NULL,
             PRIMARY KEY (group_id, seq)
         ) STRICT, WITHOUT ROWID;

         -- What this device has to send. A row holds its intent (a
         -- message's envelope, or the accounts to add or remove) until it
         -- is sealed once into the bytes that are sent until they resolve.
         -- A commit carries the roster and Welcome it was sealed with. `seq`
         -- is what the server answered; the fetch that reaches it resolves
         -- the row.
         CREATE TABLE outbox (
             id            INTEGER PRIMARY KEY,
             group_id      BLOB NOT NULL
                           REFERENCES conversations (group_id) ON DELETE CASCADE,
             kind          TEXT NOT NULL CHECK (kind IN ('message', 'add', 'remove')),
             intent        BLOB NOT NULL,
             client_msg_id TEXT UNIQUE,
             ciphertext    BLOB,
             roster_add    TEXT,
             roster_remove TEXT,
             welcome       BLOB,
             welcome_to    TEXT,
             seq           INTEGER,
             created_at    INTEGER NOT NULL,
             CHECK ((client_msg_id IS NULL) = (ciphertext IS NULL)),
             CHECK (seq IS NULL OR ciphertext IS NOT NULL),
             CHECK ((welcome IS NULL) = (welcome_to IS NULL)),
             CHECK (kind != 'message' OR
                    (roster_add IS NULL AND roster_remove IS NULL AND welcome IS NULL))
         ) STRICT;
         CREATE INDEX outbox_by_group ON outbox (group_id, id);",
    ),
    (
        3,
        // Decision 0019: the core signs in, so it keeps what a sign-in
        // needs and what it yields.
        "-- The device token registerDevice answered with, sent as Bearer;
         -- and this account's invite link, which the server cannot show
         -- again. Both only for a registered device.
         ALTER TABLE account ADD COLUMN device_token TEXT
             CHECK (device_token IS NULL OR account_id IS NOT NULL);
         ALTER TABLE account ADD COLUMN invite_link TEXT
             CHECK (invite_link IS NULL OR account_id IS NOT NULL);

         -- The sign-in waiting for Kenni's callback: the PKCE verifier, the
         -- state and the nonce it sent, and the redirect the code is for.
         -- Kept here so a sign-in outlives the process while the browser is
         -- open.
         CREATE TABLE sign_in (
             id           INTEGER PRIMARY KEY CHECK (id = 1),
             verifier     TEXT NOT NULL,
             state        TEXT NOT NULL,
             nonce        TEXT NOT NULL,
             redirect_uri TEXT NOT NULL,
             created_at   INTEGER NOT NULL
         ) STRICT;",
    ),
    (
        4,
        // Decision 0020: a commit carries its roster claim inside its own
        // bytes, and a 403 no commit explains does not end a conversation.
        "-- The server refuses this device but no commit removed it. Kept
         -- beside `state`, which changing would rebuild `conversations` and
         -- cascade into `messages`; `excluded` is only ever set on `active`.
         ALTER TABLE conversations ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0
             CHECK (excluded IN (0, 1));

         -- The outbox again, with `correct`: a commit that changes no one
         -- and tells the server the roster MLS holds. The Welcome's
         -- recipients are in the commit's claim, so `welcome_to` goes.
         CREATE TABLE outbox_0020 (
             id            INTEGER PRIMARY KEY,
             group_id      BLOB NOT NULL
                           REFERENCES conversations (group_id) ON DELETE CASCADE,
             kind          TEXT NOT NULL
                           CHECK (kind IN ('message', 'add', 'remove', 'correct')),
             intent        BLOB NOT NULL,
             client_msg_id TEXT UNIQUE,
             ciphertext    BLOB,
             roster_add    TEXT,
             roster_remove TEXT,
             welcome       BLOB,
             seq           INTEGER,
             created_at    INTEGER NOT NULL,
             CHECK ((client_msg_id IS NULL) = (ciphertext IS NULL)),
             CHECK (seq IS NULL OR ciphertext IS NOT NULL),
             CHECK (welcome IS NULL OR kind = 'add'),
             CHECK (kind IN ('add', 'remove') OR
                    (roster_add IS NULL AND roster_remove IS NULL))
         ) STRICT;
         INSERT INTO outbox_0020 (id, group_id, kind, intent, client_msg_id, ciphertext,
                                  roster_add, roster_remove, welcome, seq, created_at)
             SELECT id, group_id, kind, intent, client_msg_id, ciphertext,
                    roster_add, roster_remove, welcome, seq, created_at
             FROM outbox;
         DROP TABLE outbox;
         ALTER TABLE outbox_0020 RENAME TO outbox;
         CREATE INDEX outbox_by_group ON outbox (group_id, id);",
    ),
    (
        5,
        // Decision 0021: every commit carries the GroupInfo of its epoch,
        // and a device joins a group by an external commit.
        "-- The outbox again, with `join`: an external commit, sealed in the
         -- transaction that built the group from a GroupInfo and sent until
         -- the server answers; and each commit's GroupInfo.
         CREATE TABLE outbox_0021 (
             id            INTEGER PRIMARY KEY,
             group_id      BLOB NOT NULL
                           REFERENCES conversations (group_id) ON DELETE CASCADE,
             kind          TEXT NOT NULL
                           CHECK (kind IN ('message', 'add', 'remove', 'correct', 'join')),
             intent        BLOB NOT NULL,
             client_msg_id TEXT UNIQUE,
             ciphertext    BLOB,
             roster_add    TEXT,
             roster_remove TEXT,
             welcome       BLOB,
             group_info    BLOB,
             seq           INTEGER,
             created_at    INTEGER NOT NULL,
             CHECK ((client_msg_id IS NULL) = (ciphertext IS NULL)),
             CHECK (seq IS NULL OR ciphertext IS NOT NULL),
             CHECK (welcome IS NULL OR kind = 'add'),
             CHECK (kind IN ('add', 'remove') OR
                    (roster_add IS NULL AND roster_remove IS NULL)),
             CHECK (group_info IS NULL OR (kind != 'message' AND ciphertext IS NOT NULL)),
             CHECK (kind != 'join' OR ciphertext IS NOT NULL)
         ) STRICT;
         INSERT INTO outbox_0021 (id, group_id, kind, intent, client_msg_id, ciphertext,
                                  roster_add, roster_remove, welcome, seq, created_at)
             SELECT id, group_id, kind, intent, client_msg_id, ciphertext,
                    roster_add, roster_remove, welcome, seq, created_at
             FROM outbox;
         DROP TABLE outbox;
         ALTER TABLE outbox_0021 RENAME TO outbox;
         CREATE INDEX outbox_by_group ON outbox (group_id, id);",
    ),
    (
        6,
        // Decision 0022: the core folds each conversation into a timeline
        // in the transaction that stores the message, and the apps draw it.
        "-- One row per seq that shows something: a message, or a card for a
         -- membership change or the timer. `envelope_id` is the sender's id,
         -- which edits, deletes, reactions, replies and receipts address. A
         -- deleted message keeps its row as a tombstone.
         CREATE TABLE timeline (
             group_id       BLOB NOT NULL
                            REFERENCES conversations (group_id) ON DELETE CASCADE,
             seq            INTEGER NOT NULL,
             kind           TEXT NOT NULL
                            CHECK (kind IN ('text', 'media', 'members', 'timer')),
             sender_account TEXT NOT NULL,
             sender_device  TEXT NOT NULL,
             envelope_id    TEXT,
             ts             INTEGER NOT NULL,
             stored_at      INTEGER NOT NULL,
             text           TEXT,
             reply_to       TEXT,
             -- A media body, or a card's accounts and seconds, as JSON.
             detail         TEXT,
             edited         INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
             deleted        INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
             expires_at     INTEGER,
             PRIMARY KEY (group_id, seq),
             CHECK ((envelope_id IS NULL) = (kind IN ('members', 'timer'))),
             CHECK (deleted = 0 OR (text IS NULL AND reply_to IS NULL AND detail IS NULL))
         ) STRICT, WITHOUT ROWID;
         CREATE INDEX timeline_by_envelope ON timeline (group_id, envelope_id);

         -- Who reacted with what: one per account, whichever device sent it.
         CREATE TABLE reactions (
             group_id BLOB NOT NULL,
             seq      INTEGER NOT NULL,
             account  TEXT NOT NULL,
             emoji    TEXT NOT NULL,
             PRIMARY KEY (group_id, seq, account, emoji),
             FOREIGN KEY (group_id, seq) REFERENCES timeline (group_id, seq) ON DELETE CASCADE
         ) STRICT, WITHOUT ROWID;

         -- How far each account has read, by its receipts; this account's
         -- own row is the mark unread counts start from.
         CREATE TABLE read_state (
             group_id BLOB NOT NULL
                      REFERENCES conversations (group_id) ON DELETE CASCADE,
             account  TEXT NOT NULL,
             seq      INTEGER NOT NULL,
             PRIMARY KEY (group_id, account)
         ) STRICT, WITHOUT ROWID;

         -- The accounts in each group, as MLS holds them after each commit,
         -- or as a new conversation intends them until its first one.
         CREATE TABLE members (
             group_id BLOB NOT NULL
                      REFERENCES conversations (group_id) ON DELETE CASCADE,
             account  TEXT NOT NULL,
             PRIMARY KEY (group_id, account)
         ) STRICT, WITHOUT ROWID;
         CREATE INDEX members_by_account ON members (account);

         -- Names and marks the server gave, by `GET /v1/accounts/{id}`.
         CREATE TABLE profiles (
             account    TEXT PRIMARY KEY,
             name       TEXT,
             verified   INTEGER NOT NULL CHECK (verified IN (0, 1)),
             fetched_at INTEGER NOT NULL
         ) STRICT, WITHOUT ROWID;

         -- The toggles of 0009, on until turned off.
         CREATE TABLE settings (
             id           INTEGER PRIMARY KEY CHECK (id = 1),
             read_markers INTEGER NOT NULL CHECK (read_markers IN (0, 1)),
             typing       INTEGER NOT NULL CHECK (typing IN (0, 1))
         ) STRICT;

         -- The disappearing timer in seconds, from the last `Disappearing`.
         ALTER TABLE conversations ADD COLUMN timer INTEGER CHECK (timer IS NULL OR timer > 0);

         -- A message row whose last send got no answer, until it is sent.
         ALTER TABLE outbox ADD COLUMN failed INTEGER NOT NULL DEFAULT 0
             CHECK (failed IN (0, 1));",
    ),
    (
        7,
        "-- When a stored message disappears, by the conversation's timer
         -- when it was stored (0022), and whether it came from an account
         -- this one blocked and is never shown (0024).
         ALTER TABLE messages ADD COLUMN expires_at INTEGER;
         ALTER TABLE messages ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0
             CHECK (hidden IN (0, 1));
         CREATE INDEX messages_by_expiry ON messages (expires_at)
             WHERE expires_at IS NOT NULL;
         CREATE INDEX timeline_by_expiry ON timeline (expires_at)
             WHERE expires_at IS NOT NULL;

         -- The accounts this one blocked, as the server last listed them,
         -- or as this device set them since.
         CREATE TABLE blocks (
             account    TEXT PRIMARY KEY,
             blocked_at INTEGER NOT NULL
         ) STRICT, WITHOUT ROWID;",
    ),
    (
        8,
        // Decision 0025.
        "-- This device's push token, and whether the server has it.
         CREATE TABLE push (
             id      INTEGER PRIMARY KEY CHECK (id = 1),
             token   TEXT NOT NULL,
             sandbox INTEGER NOT NULL CHECK (sandbox IN (0, 1)),
             sent    INTEGER NOT NULL CHECK (sent IN (0, 1))
         ) STRICT;

         -- The highest seq `notices()` looked at, and the newest seq on a
         -- notice still shown. What is here already is never shown.
         ALTER TABLE conversations ADD COLUMN noticed INTEGER NOT NULL DEFAULT 0;
         ALTER TABLE conversations ADD COLUMN shown INTEGER;
         UPDATE conversations SET noticed = COALESCE(
             (SELECT MAX(seq) FROM timeline t WHERE t.group_id = conversations.group_id), 0);",
    ),
    (
        9,
        // Decisions 0028 and 0029.
        "-- The outbox again, with `remove_devices`: a commit that removes
         -- leaves the server no longer serves, one `account/device` per line.
         -- It names an account in `roster_remove` only when its last leaf
         -- goes.
         CREATE TABLE outbox_0028 (
             id            INTEGER PRIMARY KEY,
             group_id      BLOB NOT NULL
                           REFERENCES conversations (group_id) ON DELETE CASCADE,
             kind          TEXT NOT NULL
                           CHECK (kind IN ('message', 'add', 'remove', 'correct', 'join',
                                           'remove_devices')),
             intent        BLOB NOT NULL,
             client_msg_id TEXT UNIQUE,
             ciphertext    BLOB,
             roster_add    TEXT,
             roster_remove TEXT,
             welcome       BLOB,
             group_info    BLOB,
             seq           INTEGER,
             created_at    INTEGER NOT NULL,
             failed        INTEGER NOT NULL DEFAULT 0 CHECK (failed IN (0, 1)),
             CHECK ((client_msg_id IS NULL) = (ciphertext IS NULL)),
             CHECK (seq IS NULL OR ciphertext IS NOT NULL),
             CHECK (welcome IS NULL OR kind = 'add'),
             CHECK (kind IN ('add', 'remove', 'remove_devices') OR
                    (roster_add IS NULL AND roster_remove IS NULL)),
             CHECK (group_info IS NULL OR (kind != 'message' AND ciphertext IS NOT NULL)),
             CHECK (kind != 'join' OR ciphertext IS NOT NULL)
         ) STRICT;
         INSERT INTO outbox_0028 (id, group_id, kind, intent, client_msg_id, ciphertext,
                                  roster_add, roster_remove, welcome, group_info, seq,
                                  created_at, failed)
             SELECT id, group_id, kind, intent, client_msg_id, ciphertext,
                    roster_add, roster_remove, welcome, group_info, seq,
                    created_at, failed
             FROM outbox;
         DROP TABLE outbox;
         ALTER TABLE outbox_0028 RENAME TO outbox;
         CREATE INDEX outbox_by_group ON outbox (group_id, id);

         -- When this device last asked the server which devices a
         -- conversation's accounts have (0028).
         ALTER TABLE conversations ADD COLUMN devices_checked_at INTEGER;

         -- When this device last counted its KeyPackages on the server (0029).
         ALTER TABLE account ADD COLUMN key_packages_stocked_at INTEGER;",
    ),
    (
        10,
        // Decision 0033: Google or Kenni, and a sign-in or a link.
        "-- Who the pending sign-in went to, and whether it signs this device
         -- in or links Kenni to the account it is signed in as.
         ALTER TABLE sign_in ADD COLUMN provider TEXT NOT NULL DEFAULT 'kenni'
             CHECK (provider IN ('kenni', 'google'));
         ALTER TABLE sign_in ADD COLUMN purpose TEXT NOT NULL DEFAULT 'sign_in'
             CHECK (purpose IN ('sign_in', 'link'));",
    ),
    (
        11,
        // Decision 0042.
        "-- The account's muted conversations, as the server last listed them
         -- or a `mute` frame said since: until when, in Unix milliseconds,
         -- or NULL until turned back on. A conversation this device has not
         -- joined yet may be here already.
         CREATE TABLE mutes (
             group_id BLOB PRIMARY KEY,
             until    INTEGER
         ) STRICT, WITHOUT ROWID;",
    ),
    (
        12,
        // Decision 0040: a shared Fljótið post.
        "-- The timeline again, with `post`: a shared post, whose `detail`
         -- holds the post's id and nothing of the post itself. Dropping the
         -- old table cascades into `reactions`, so they are kept aside.
         CREATE TEMP TABLE reactions_0040 AS SELECT * FROM reactions;
         CREATE TABLE timeline_0040 (
             group_id       BLOB NOT NULL
                            REFERENCES conversations (group_id) ON DELETE CASCADE,
             seq            INTEGER NOT NULL,
             kind           TEXT NOT NULL
                            CHECK (kind IN ('text', 'media', 'members', 'timer', 'post')),
             sender_account TEXT NOT NULL,
             sender_device  TEXT NOT NULL,
             envelope_id    TEXT,
             ts             INTEGER NOT NULL,
             stored_at      INTEGER NOT NULL,
             text           TEXT,
             reply_to       TEXT,
             detail         TEXT,
             edited         INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
             deleted        INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
             expires_at     INTEGER,
             PRIMARY KEY (group_id, seq),
             CHECK ((envelope_id IS NULL) = (kind IN ('members', 'timer'))),
             CHECK (deleted = 0 OR (text IS NULL AND reply_to IS NULL AND detail IS NULL)),
             CHECK (kind != 'post' OR text IS NULL)
         ) STRICT, WITHOUT ROWID;
         INSERT INTO timeline_0040 (group_id, seq, kind, sender_account, sender_device,
                                    envelope_id, ts, stored_at, text, reply_to, detail,
                                    edited, deleted, expires_at)
             SELECT group_id, seq, kind, sender_account, sender_device,
                    envelope_id, ts, stored_at, text, reply_to, detail,
                    edited, deleted, expires_at
             FROM timeline;
         DROP TABLE timeline;
         ALTER TABLE timeline_0040 RENAME TO timeline;
         CREATE INDEX timeline_by_envelope ON timeline (group_id, envelope_id);
         CREATE INDEX timeline_by_expiry ON timeline (expires_at)
             WHERE expires_at IS NOT NULL;
         INSERT INTO reactions (group_id, seq, account, emoji)
             SELECT group_id, seq, account, emoji FROM reactions_0040;
         DROP TABLE reactions_0040;",
    ),
    (
        13,
        // Decision 0039.
        "-- The version of each account's photo, as the server last gave it,
         -- NULL when it has none or a block stands between the two. The
         -- files are in the media folder's `photos/`, by account and version.
         ALTER TABLE profiles ADD COLUMN photo TEXT;",
    ),
    (
        14,
        "-- A message row the server refused, which sending it again would
         -- not change: it shows failed and waits for `retry`, and the rows
         -- behind it go on.
         ALTER TABLE outbox ADD COLUMN refused INTEGER NOT NULL DEFAULT 0
             CHECK (refused IN (0, 1));

         -- When the server last refused this device's join outright (0021):
         -- `sync` tries again an hour later, a notify or `retry` at once.
         ALTER TABLE conversations ADD COLUMN join_refused_at INTEGER;",
    ),
];

pub struct Store {
    connection: Connection,
    path: PathBuf,
}

impl Store {
    /// Opens or creates `<dir>/spjall.db` with `key` and brings it to the
    /// latest schema. A wrong key fails here, not on a later query.
    pub fn open(dir: &Path, key: &Key) -> rusqlite::Result<Self> {
        let path = dir.join(FILE_NAME);
        let mut connection = connect(&path, key)?;
        migrate(&mut connection, MIGRATIONS)?;
        Ok(Self { connection, path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The highest migration applied.
    pub fn schema_version(&self) -> rusqlite::Result<u32> {
        self.connection.query_row(
            "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
            [],
            |row| row.get(0),
        )
    }

    /// Runs `f` in a write transaction that holds the write lock from its
    /// first statement, so a read inside it cannot go stale before the write.
    /// It commits when `f` returns `Ok` and rolls back otherwise.
    pub fn write<T>(
        &mut self,
        f: impl FnOnce(&Transaction) -> rusqlite::Result<T>,
    ) -> rusqlite::Result<T> {
        self.try_write(f)
    }

    /// `write` for a caller with its own error type, which rolls back the
    /// same way.
    pub fn try_write<T, E: From<rusqlite::Error>>(
        &mut self,
        f: impl FnOnce(&Transaction) -> Result<T, E>,
    ) -> Result<T, E> {
        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = f(&tx)?;
        tx.commit()?;
        Ok(value)
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn connect(path: &Path, key: &Key) -> rusqlite::Result<Connection> {
    let connection = Connection::open(path)?;
    // The key must be the first statement on the connection. Hex digits
    // only, so formatting it into the pragma cannot inject anything.
    connection.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex(key)))?;
    connection.query_row("SELECT COUNT(*) FROM sqlite_master", [], |_| Ok(()))?;
    connection.busy_timeout(BUSY_TIMEOUT)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "foreign_keys", true)?;
    Ok(connection)
}

fn migrate(connection: &mut Connection, migrations: &[(u32, &str)]) -> rusqlite::Result<()> {
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
             version    INTEGER PRIMARY KEY,
             applied_at INTEGER NOT NULL
         ) STRICT;",
    )?;
    let current: u32 = tx.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;
    for (version, sql) in migrations.iter().filter(|(version, _)| *version > current) {
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, unixepoch())",
            [version],
        )?;
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: Key = [7; 32];

    #[test]
    fn file_name_matches_ids_json() {
        let ids: serde_json::Value =
            serde_json::from_str(include_str!("../../../identifiers/ids.json")).unwrap();
        assert_eq!(ids["store"]["databaseFile"], FILE_NAME);
    }

    #[test]
    fn migrations_are_numbered_from_one_without_gaps() {
        for (index, (version, _)) in MIGRATIONS.iter().enumerate() {
            assert_eq!(*version as usize, index + 1);
        }
    }

    #[test]
    fn open_creates_the_file_at_the_latest_schema() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(dir.path(), &KEY).unwrap();
        assert_eq!(store.path(), dir.path().join("spjall.db"));
        assert!(store.path().exists());
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as u32);
    }

    #[test]
    fn reopening_applies_nothing_twice() {
        let dir = tempfile::tempdir().unwrap();
        Store::open(dir.path(), &KEY).unwrap();
        let store = Store::open(dir.path(), &KEY).unwrap();
        let rows: u32 = store
            .connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(rows, MIGRATIONS.len() as u32);
    }

    /// A device that ran only migration 1 keeps its MLS state when it
    /// upgrades.
    #[test]
    fn an_upgrade_keeps_what_was_stored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let mut old = connect(&path, &KEY).unwrap();
        migrate(&mut old, &MIGRATIONS[..1]).unwrap();
        old.execute("INSERT INTO kv VALUES (x'01', x'02')", [])
            .unwrap();
        drop(old);

        let store = Store::open(dir.path(), &KEY).unwrap();
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as u32);
        let value: Vec<u8> = store
            .connection
            .query_row("SELECT value FROM kv WHERE key = x'01'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(value, [2]);
    }

    /// Migration 12 rebuilds the timeline (0040); the rows and the
    /// reactions on them survive it, though dropping the old table
    /// cascades into `reactions`.
    #[test]
    fn the_timeline_rebuild_keeps_its_rows_and_reactions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let mut old = connect(&path, &KEY).unwrap();
        migrate(&mut old, &MIGRATIONS[..11]).unwrap();
        old.execute_batch(
            "INSERT INTO conversations (group_id, cursor, created_at) VALUES (x'01', 2, 0);
             INSERT INTO timeline (group_id, seq, kind, sender_account, sender_device,
                                   envelope_id, ts, stored_at, text, expires_at)
                 VALUES (x'01', 1, 'text', 'a', 'a1', 'm1', 1, 1, 'hæ', 9);
             INSERT INTO reactions VALUES (x'01', 1, 'b', '👍');",
        )
        .unwrap();
        drop(old);

        let mut store = Store::open(dir.path(), &KEY).unwrap();
        let kept: (String, u32, String) = store
            .connection
            .query_row(
                "SELECT t.text, t.expires_at, r.emoji
                 FROM timeline t JOIN reactions r USING (group_id, seq)",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(kept, ("hæ".into(), 9, "👍".into()));
        // A share is its own kind, and holds no text of the post.
        let post = |text: &str| {
            format!(
                "INSERT INTO timeline (group_id, seq, kind, sender_account, sender_device,
                                       envelope_id, ts, stored_at, text, detail)
                     VALUES (x'01', 2, 'post', 'a', 'a1', 'm2', 1, 1, {text}, '{{}}')"
            )
        };
        assert!(refused(&mut store, &post("'færslan'")));
        assert!(!refused(&mut store, &post("NULL")));
        // The cascade still holds after the rename.
        store
            .write(|tx| tx.execute("DELETE FROM timeline WHERE seq = 1", []))
            .unwrap();
        let left: u32 = store
            .connection
            .query_row("SELECT COUNT(*) FROM reactions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(left, 0);
    }

    fn refused(store: &mut Store, sql: &str) -> bool {
        store.write(|tx| tx.execute_batch(sql)).is_err()
    }

    #[test]
    fn the_client_tables_hold_their_invariants() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path(), &KEY).unwrap();
        store
            .write(|tx| {
                tx.execute_batch(
                    "INSERT INTO account (id, device_key) VALUES (1, x'01');
                     UPDATE account SET account_id = 'a_1', device_id = 'd_1';
                     INSERT INTO conversations (group_id, cursor, created_at) VALUES (x'01', 0, 0);
                     INSERT INTO messages (group_id, seq, sender_account, sender_device,
                                           envelope, stored_at)
                         VALUES (x'01', 1, 'a_1', 'd_1', x'00', 0);
                     INSERT INTO outbox (group_id, kind, intent, created_at)
                         VALUES (x'01', 'message', x'00', 0);",
                )
            })
            .unwrap();

        // A token and an invite link belong to a registered device.
        assert!(refused(
            &mut store,
            "UPDATE account SET account_id = NULL, device_id = NULL, device_token = 't'"
        ));
        assert!(!refused(
            &mut store,
            "UPDATE account SET device_token = 't', invite_link = 'l'"
        ));
        // Hidden is a flag (0024).
        assert!(refused(&mut store, "UPDATE messages SET hidden = 2"));
        assert!(!refused(&mut store, "UPDATE messages SET hidden = 1"));
        // One pending sign-in.
        assert!(refused(
            &mut store,
            "INSERT INTO sign_in (id, verifier, state, nonce, redirect_uri, created_at)
                 VALUES (2, 'v', 's', 'n', 'r', 0)"
        ));
        // It went to Google or Kenni, to sign in or to link (0033).
        assert!(refused(
            &mut store,
            "INSERT INTO sign_in (id, verifier, state, nonce, redirect_uri, created_at, provider)
                 VALUES (1, 'v', 's', 'n', 'r', 0, 'apple')"
        ));
        assert!(refused(
            &mut store,
            "INSERT INTO sign_in (id, verifier, state, nonce, redirect_uri, created_at, purpose)
                 VALUES (1, 'v', 's', 'n', 'r', 0, 'merge')"
        ));

        // One account per store.
        assert!(refused(
            &mut store,
            "INSERT INTO account (id, device_key) VALUES (2, x'02')"
        ));
        // A conversation's state is one of four, and `excluded` a flag.
        assert!(refused(
            &mut store,
            "INSERT INTO conversations (group_id, state, cursor, created_at)
                 VALUES (x'02', 'gone', 0, 0)"
        ));
        assert!(refused(&mut store, "UPDATE conversations SET excluded = 2"));
        // History and the outbox belong to a conversation the store knows.
        assert!(refused(
            &mut store,
            "INSERT INTO messages VALUES (x'09', 1, 'a_1', 'd_1', x'00', 0)"
        ));
        // A clientMsgId and its ciphertext are sealed together, and only
        // sealed bytes are given a seq.
        assert!(refused(
            &mut store,
            "UPDATE outbox SET client_msg_id = 'm1'"
        ));
        assert!(refused(&mut store, "UPDATE outbox SET seq = 1"));
        // A message and a correction change no roster, and only an add
        // carries a Welcome.
        assert!(refused(
            &mut store,
            "UPDATE outbox SET client_msg_id = 'm1', ciphertext = x'01', roster_add = 'b'"
        ));
        assert!(refused(
            &mut store,
            "INSERT INTO outbox (group_id, kind, intent, client_msg_id, ciphertext, roster_remove,
                                 created_at)
                 VALUES (x'01', 'correct', x'', 'c1', x'01', 'b', 0)"
        ));
        assert!(refused(
            &mut store,
            "INSERT INTO outbox (group_id, kind, intent, client_msg_id, ciphertext, welcome, created_at)
                 VALUES (x'01', 'remove', CAST('b' AS BLOB), 'c1', x'01', x'01', 0)"
        ));
        assert!(!refused(
            &mut store,
            "INSERT INTO outbox (group_id, kind, intent, client_msg_id, ciphertext, welcome, created_at)
                 VALUES (x'01', 'add', CAST('b' AS BLOB), 'c1', x'01', x'01', 0);
             DELETE FROM outbox WHERE client_msg_id = 'c1';"
        ));
        // A join is sealed when it is made, and only a sealed commit
        // carries a GroupInfo.
        assert!(refused(
            &mut store,
            "INSERT INTO outbox (group_id, kind, intent, created_at)
                 VALUES (x'01', 'join', x'', 0)"
        ));
        assert!(refused(
            &mut store,
            "INSERT INTO outbox (group_id, kind, intent, group_info, created_at)
                 VALUES (x'01', 'correct', x'', x'01', 0)"
        ));
        assert!(refused(
            &mut store,
            "UPDATE outbox SET client_msg_id = 'm1', ciphertext = x'01', group_info = x'01'"
        ));
        assert!(!refused(
            &mut store,
            "INSERT INTO outbox (group_id, kind, intent, client_msg_id, ciphertext, group_info,
                                 created_at)
                 VALUES (x'01', 'join', x'', 'j1', x'01', x'01', 0);
             DELETE FROM outbox WHERE client_msg_id = 'j1';"
        ));
        // A clientMsgId is never reused.
        assert!(!refused(
            &mut store,
            "UPDATE outbox SET client_msg_id = 'm1', ciphertext = x'01', seq = 1"
        ));
        assert!(refused(
            &mut store,
            "INSERT INTO outbox (group_id, kind, intent, client_msg_id, ciphertext, created_at)
                 VALUES (x'01', 'message', x'00', 'm1', x'01', 0)"
        ));

        // Forgetting a conversation forgets its history and its outbox.
        store
            .write(|tx| tx.execute("DELETE FROM conversations", []))
            .unwrap();
        let left: u32 = store
            .connection
            .query_row(
                "SELECT (SELECT COUNT(*) FROM messages) + (SELECT COUNT(*) FROM outbox)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(left, 0);
    }

    #[test]
    fn a_wrong_key_cannot_open_it() {
        let dir = tempfile::tempdir().unwrap();
        drop(Store::open(dir.path(), &KEY).unwrap());
        assert!(Store::open(dir.path(), &[8; 32]).is_err());
        assert!(Store::open(dir.path(), &KEY).is_ok());
    }

    #[test]
    fn the_file_is_not_plaintext_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path(), &KEY).unwrap();
        store
            .write(|tx| tx.execute("INSERT INTO kv VALUES (x'01', CAST('needle' AS BLOB))", []))
            .unwrap();
        let path = store.path().to_owned();
        drop(store);
        let bytes = std::fs::read(path).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3\0"));
        assert!(!bytes.windows(6).any(|window| window == b"needle"));
    }

    #[test]
    fn a_failed_write_rolls_back() {
        let dir = tempfile::tempdir().unwrap();
        let mut store = Store::open(dir.path(), &KEY).unwrap();
        let failed = store.write(|tx| {
            tx.execute("INSERT INTO kv VALUES (x'01', x'01')", [])?;
            tx.execute("INSERT INTO kv VALUES (x'01', x'02')", [])
        });
        assert!(failed.is_err());
        let rows: u32 = store
            .connection
            .query_row("SELECT COUNT(*) FROM kv", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
    }

    /// Read-modify-write from separate connections, as the app and its
    /// extension do: no update is lost and no writer fails with "locked".
    #[test]
    fn writers_on_separate_connections_serialize() {
        const WRITERS: u32 = 4;
        const EACH: u32 = 200;
        let dir = tempfile::tempdir().unwrap();
        Store::open(dir.path(), &KEY)
            .unwrap()
            .write(|tx| tx.execute("INSERT INTO kv VALUES (x'00', ?1)", [0u32.to_be_bytes()]))
            .unwrap();
        let start = std::sync::Arc::new(std::sync::Barrier::new(WRITERS as usize));
        let threads: Vec<_> = (0..WRITERS)
            .map(|_| {
                let dir = dir.path().to_owned();
                let start = start.clone();
                std::thread::spawn(move || {
                    let mut store = Store::open(&dir, &KEY).unwrap();
                    start.wait();
                    for _ in 0..EACH {
                        store
                            .write(|tx| {
                                let n: [u8; 4] = tx.query_row(
                                    "SELECT value FROM kv WHERE key = x'00'",
                                    [],
                                    |row| row.get(0),
                                )?;
                                let next = u32::from_be_bytes(n) + 1;
                                tx.execute(
                                    "UPDATE kv SET value = ?1 WHERE key = x'00'",
                                    [next.to_be_bytes()],
                                )
                            })
                            .unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }
        let store = Store::open(dir.path(), &KEY).unwrap();
        let n: [u8; 4] = store
            .connection
            .query_row("SELECT value FROM kv WHERE key = x'00'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(u32::from_be_bytes(n), WRITERS * EACH);
    }
}
