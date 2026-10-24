//! Blobs as rows of a second encrypted database in the store's OPFS pool,
//! under the store's key (decision 0081). A directory is a path prefix:
//! it exists while a blob is under it.
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use spjall_client::{BlobStore, BlobWrite};
use spjall_store::rusqlite::{Connection, OptionalExtension, params};
use spjall_store::{Key, connect};

/// The blob database. Cloning shares the connection, so the transport can
/// read an upload's bytes from the same rows the client wrote.
#[derive(Clone)]
pub struct PoolBlobs {
    connection: Arc<Mutex<Connection>>,
}

fn io_error(error: spjall_store::rusqlite::Error) -> io::Error {
    io::Error::other(error.to_string())
}

fn not_found(path: &Path) -> io::Error {
    io::Error::new(
        io::ErrorKind::NotFound,
        format!("no blob at {}", path.display()),
    )
}

/// The key of a path: no trailing slash.
fn key(path: &Path) -> String {
    let text = path.to_string_lossy();
    match text.trim_end_matches('/') {
        "" => "/".to_owned(),
        trimmed => trimmed.to_owned(),
    }
}

/// The half-open key range of everything under `dir`: `dir/` up to `dir0`,
/// since `0` is the byte after `/`.
fn under(dir: &Path) -> (String, String) {
    let dir = key(dir);
    let prefix = if dir == "/" { dir } else { format!("{dir}/") };
    let mut end = prefix.clone();
    end.pop();
    end.push('0');
    (prefix, end)
}

impl PoolBlobs {
    /// Opens (creating it if need be) the blob database at `path` in the
    /// pool, under the store's `key`.
    pub fn open(path: &Path, key: &Key) -> io::Result<Self> {
        let connection = connect(path, key).map_err(io_error)?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS blob (
                     path TEXT PRIMARY KEY NOT NULL,
                     data BLOB NOT NULL
                 ) WITHOUT ROWID;",
            )
            .map_err(io_error)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    fn lock(&self) -> MutexGuard<'_, Connection> {
        self.connection
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// The bytes of the blob at `path`.
    pub fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        self.lock()
            .query_row(
                "SELECT data FROM blob WHERE path = ?1",
                [key(path)],
                |row| row.get(0),
            )
            .optional()
            .map_err(io_error)?
            .ok_or_else(|| not_found(path))
    }

    fn put(&self, path: &Path, bytes: &[u8]) -> io::Result<()> {
        self.lock()
            .execute(
                "INSERT OR REPLACE INTO blob (path, data) VALUES (?1, ?2)",
                params![key(path), bytes],
            )
            .map_err(io_error)?;
        Ok(())
    }
}

/// Buffers in memory and commits one row on `finish`; dropped unfinished,
/// it leaves nothing.
struct PoolWriter {
    blobs: PoolBlobs,
    path: PathBuf,
    buffer: Vec<u8>,
}

impl Write for PoolWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.buffer.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl BlobWrite for PoolWriter {
    fn finish(self: Box<Self>) -> io::Result<()> {
        self.blobs.put(&self.path, &self.buffer)
    }
}

impl BlobStore for PoolBlobs {
    fn open_read(&self, path: &Path) -> io::Result<Box<dyn Read>> {
        Ok(Box::new(Cursor::new(self.read(path)?)))
    }

    fn create_write(&self, path: &Path) -> io::Result<Box<dyn BlobWrite>> {
        Ok(Box::new(PoolWriter {
            blobs: self.clone(),
            path: path.to_owned(),
            buffer: Vec::new(),
        }))
    }

    fn len(&self, path: &Path) -> io::Result<u64> {
        let length: i64 = self
            .lock()
            .query_row(
                "SELECT length(data) FROM blob WHERE path = ?1",
                [key(path)],
                |row| row.get(0),
            )
            .optional()
            .map_err(io_error)?
            .ok_or_else(|| not_found(path))?;
        Ok(u64::try_from(length).unwrap_or(0))
    }

    fn exists(&self, path: &Path) -> bool {
        self.lock()
            .query_row(
                "SELECT 1 FROM blob WHERE path = ?1",
                [key(path)],
                |_| Ok(()),
            )
            .optional()
            .is_ok_and(|row| row.is_some())
    }

    fn create_dir_all(&self, _dir: &Path) -> io::Result<()> {
        Ok(())
    }

    fn copy(&self, from: &Path, to: &Path) -> io::Result<()> {
        let bytes = self.read(from)?;
        self.put(to, &bytes)
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        let bytes = self.read(from)?;
        let mut connection = self.lock();
        let tx = connection.transaction().map_err(io_error)?;
        tx.execute(
            "INSERT OR REPLACE INTO blob (path, data) VALUES (?1, ?2)",
            params![key(to), bytes],
        )
        .map_err(io_error)?;
        if key(from) != key(to) {
            tx.execute("DELETE FROM blob WHERE path = ?1", [key(from)])
                .map_err(io_error)?;
        }
        tx.commit().map_err(io_error)
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        self.lock()
            .execute("DELETE FROM blob WHERE path = ?1", [key(path)])
            .map_err(io_error)?;
        Ok(())
    }

    /// A directory is a prefix, so an empty one is already gone.
    fn remove_dir(&self, _dir: &Path) -> io::Result<()> {
        Ok(())
    }

    fn remove_dir_all(&self, dir: &Path) -> io::Result<()> {
        let (start, end) = under(dir);
        self.lock()
            .execute(
                "DELETE FROM blob WHERE path >= ?1 AND path < ?2",
                [start, end],
            )
            .map_err(io_error)?;
        Ok(())
    }

    fn list_files(&self, dir: &Path) -> io::Result<Vec<PathBuf>> {
        let (start, end) = under(dir);
        let connection = self.lock();
        let mut statement = connection
            .prepare("SELECT path FROM blob WHERE path >= ?1 AND path < ?2 ORDER BY path")
            .map_err(io_error)?;
        let paths = statement
            .query_map([&start, &end], |row| row.get::<_, String>(0))
            .map_err(io_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(io_error)?;
        Ok(paths
            .into_iter()
            .filter(|path| !path[start.len()..].contains('/'))
            .map(PathBuf::from)
            .collect())
    }
}
