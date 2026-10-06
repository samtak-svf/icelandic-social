//! The core's one SQLite file (decision 0016): MLS state and decrypted history
//! together, encrypted with SQLCipher, opened only through this crate by the
//! app and by its notification extension or messaging service.
//!
//! Decrypt-and-store is one `BEGIN IMMEDIATE` transaction (`Store::write`).
//! SQLite's write lock is the single-writer lock across processes, so the
//! process that advances a ratchet is the one that stores the plaintext.
//! `spjall_mls::storage` keeps the OpenMLS state in `kv`.

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
const MIGRATIONS: &[(u32, &str)] = &[(
    1,
    "CREATE TABLE kv (
         key   BLOB PRIMARY KEY,
         value BLOB NOT NULL
     ) STRICT, WITHOUT ROWID;",
)];

pub struct Store {
    connection: Connection,
    path: PathBuf,
}

impl Store {
    /// Opens or creates `<dir>/spjall.db` with `key` and brings it to the
    /// latest schema. A wrong key fails here, not on a later query.
    pub fn open(dir: &Path, key: &Key) -> rusqlite::Result<Self> {
        let path = dir.join(FILE_NAME);
        let mut connection = Connection::open(&path)?;
        // The key must be the first statement on the connection. Hex digits
        // only, so formatting it into the pragma cannot inject anything.
        connection.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex(key)))?;
        connection.query_row("SELECT COUNT(*) FROM sqlite_master", [], |_| Ok(()))?;
        connection.busy_timeout(BUSY_TIMEOUT)?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", true)?;
        migrate(&mut connection)?;
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

fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
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
    for (version, sql) in MIGRATIONS.iter().filter(|(version, _)| *version > current) {
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
