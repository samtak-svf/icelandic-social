//! The core's own SQLite file (0006): MLS state lives here, never in the
//! Keychain (0002). SQLite is compiled in (`bundled`), so both apps get the
//! same version. Phase 1 adds the OpenMLS storage provider over `kv` and the
//! single-writer rule shared by the app and its notification extension.

use std::path::{Path, PathBuf};

pub use rusqlite;
use rusqlite::Connection;

/// `store.databaseFiles.mls` in `identifiers/ids.json`; a test holds them equal.
pub const FILE_NAME: &str = "mls.db";

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
    /// Opens or creates `<dir>/mls.db` and brings it to the latest schema.
    pub fn open(dir: &Path) -> rusqlite::Result<Self> {
        let path = dir.join(FILE_NAME);
        let mut connection = Connection::open(&path)?;
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
}

fn migrate(connection: &mut Connection) -> rusqlite::Result<()> {
    let tx = connection.transaction()?;
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

    #[test]
    fn file_name_matches_ids_json() {
        let ids: serde_json::Value =
            serde_json::from_str(include_str!("../../../identifiers/ids.json")).unwrap();
        assert_eq!(ids["store"]["databaseFiles"]["mls"], FILE_NAME);
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
        let store = Store::open(dir.path()).unwrap();
        assert_eq!(store.path(), dir.path().join("mls.db"));
        assert!(store.path().exists());
        assert_eq!(store.schema_version().unwrap(), MIGRATIONS.len() as u32);
    }

    #[test]
    fn reopening_applies_nothing_twice() {
        let dir = tempfile::tempdir().unwrap();
        Store::open(dir.path()).unwrap();
        let store = Store::open(dir.path()).unwrap();
        let rows: u32 = store
            .connection
            .query_row("SELECT COUNT(*) FROM schema_migrations", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(rows, MIGRATIONS.len() as u32);
    }
}
