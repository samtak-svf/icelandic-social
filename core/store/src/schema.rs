//! Bringing a store to the latest schema: the migrations of `MIGRATIONS` (kept
//! in `lib.rs`, where `tooling/migrations-freeze.mjs` reads them) and the
//! repairs of columns a store may lack whatever its history.

use rusqlite::{Connection, TransactionBehavior};

pub(crate) fn migrate(
    connection: &mut Connection,
    migrations: &[(u32, &str)],
) -> rusqlite::Result<()> {
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

/// Columns a store has whatever its history, added when missing (0050).
/// Version 14 means two things on devices: core 0.18 stored the outbox's
/// `refused` and the conversation's `join_refused_at` under it, a later
/// change dropped that migration by mistake, and 0.20 stored the timeline's
/// `received_at` under the same number. So neither history runs the
/// other's 14, and no later migration can say which one a store has.
pub(crate) const REPAIRS: &[(&str, &str, &str)] = &[
    ("timeline", "received_at", "INTEGER"),
    (
        "outbox",
        "refused",
        "INTEGER NOT NULL DEFAULT 0 CHECK (refused IN (0, 1))",
    ),
    ("conversations", "join_refused_at", "INTEGER"),
];

pub(crate) fn repair(
    connection: &mut Connection,
    repairs: &[(&str, &str, &str)],
) -> rusqlite::Result<()> {
    let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    for (table, column, definition) in repairs {
        let present: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2)",
            [table, column],
            |row| row.get(0),
        )?;
        if !present {
            tx.execute_batch(&format!(
                "ALTER TABLE {table} ADD COLUMN {column} {definition}"
            ))?;
        }
    }
    tx.commit()
}
