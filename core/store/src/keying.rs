//! Opening a database and giving it its key, one thread at a time.

use std::path::Path;
use std::sync::{Mutex, PoisonError};

use rusqlite::Connection;

use crate::{Key, hex};

/// Opens `path` and keys the connection. Threads opening a process's first
/// databases at once were refused, and once crashed; with one connection keyed
/// first they were not (#81). So only one thread does this at a time.
pub(crate) fn open_keyed(path: &Path, key: &Key) -> rusqlite::Result<Connection> {
    static KEYING: Mutex<()> = Mutex::new(());
    let _keying = KEYING.lock().unwrap_or_else(PoisonError::into_inner);
    let connection = Connection::open(path)?;
    // The key must be the first statement on the connection. Hex digits
    // only, so formatting it into the pragma cannot inject anything.
    connection.execute_batch(&format!("PRAGMA key = \"x'{}'\";", hex(key)))?;
    Ok(connection)
}
