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
                    "INSERT INTO account VALUES (1, x'01', NULL, NULL);
                     UPDATE account SET account_id = 'a_1', device_id = 'd_1';
                     INSERT INTO conversations (group_id, cursor, created_at) VALUES (x'01', 0, 0);
                     INSERT INTO messages VALUES (x'01', 1, 'a_1', 'd_1', x'00', 0);
                     INSERT INTO outbox (group_id, kind, intent, created_at)
                         VALUES (x'01', 'message', x'00', 0);",
                )
            })
            .unwrap();

        // One account per store.
        assert!(refused(
            &mut store,
            "INSERT INTO account VALUES (2, 'a_2', 'd_2')"
        ));
        // A conversation's state is one of three.
        assert!(refused(
            &mut store,
            "INSERT INTO conversations VALUES (x'02', 'gone', 0, 0)"
        ));
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
        // A message carries no roster or Welcome, and a Welcome names who
        // it is for.
        assert!(refused(
            &mut store,
            "UPDATE outbox SET client_msg_id = 'm1', ciphertext = x'01', roster_add = 'b'"
        ));
        assert!(refused(
            &mut store,
            "INSERT INTO outbox (group_id, kind, intent, client_msg_id, ciphertext, welcome, created_at)
                 VALUES (x'01', 'add', CAST('b' AS BLOB), 'c1', x'01', x'01', 0)"
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
