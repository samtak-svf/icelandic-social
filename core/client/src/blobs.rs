//! The blob store seam (#298, decision 0064). Native apps keep decrypted
//! media, profile photos and social images on the OS file system (`FsBlobs`);
//! a browser Web Worker keeps them in memory or OPFS (`MemBlobs` or a custom
//! [`BlobStore`]) because `std::fs` on `wasm32-unknown-unknown` returns
//! `Unsupported` at run time.
//!
//! `clippy.toml` forbids `std::fs` everywhere else in `spjall-client`.

#![allow(clippy::disallowed_methods)] // the one module that touches std::fs

use std::collections::BTreeMap;
use std::fs::{self, File};
use std::io::{self, BufWriter, Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

/// A writer into a [`BlobStore`] that flushes and syncs when finished.
pub trait BlobWrite: Write {
    fn finish(self: Box<Self>) -> io::Result<()>;
}

/// Where the client reads and writes media, profile photos and social images.
pub trait BlobStore: Send + Sync {
    /// Opens `path` for streaming reads.
    fn open_read(&self, path: &Path) -> io::Result<Box<dyn Read>>;

    /// Creates or truncates `path` for streaming writes; [`BlobWrite::finish`]
    /// flushes and commits it.
    fn create_write(&self, path: &Path) -> io::Result<Box<dyn BlobWrite>>;

    /// The byte length of the blob at `path`.
    fn len(&self, path: &Path) -> io::Result<u64>;

    /// Whether a blob exists at `path`.
    fn exists(&self, path: &Path) -> bool;

    /// Ensures the directory `dir` exists.
    fn create_dir_all(&self, dir: &Path) -> io::Result<()>;

    /// Copies the blob at `from` to `to`.
    fn copy(&self, from: &Path, to: &Path) -> io::Result<()>;

    /// Moves the blob at `from` to `to`.
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;

    /// Removes the blob at `path` if present.
    fn remove_file(&self, path: &Path) -> io::Result<()>;

    /// Removes an empty directory at `dir` if present.
    fn remove_dir(&self, dir: &Path) -> io::Result<()>;

    /// Removes `dir` and every blob under it.
    fn remove_dir_all(&self, dir: &Path) -> io::Result<()>;

    /// Every regular file directly inside `dir`.
    fn list_files(&self, dir: &Path) -> io::Result<Vec<PathBuf>>;
}

/// The OS file system: the default [`BlobStore`] on Android, iOS and desktop.
#[derive(Debug, Default, Clone, Copy)]
pub struct FsBlobs;

struct FsWriter(BufWriter<File>);

impl Write for FsWriter {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        self.0.write(buf)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

impl BlobWrite for FsWriter {
    fn finish(self: Box<Self>) -> io::Result<()> {
        self.0.into_inner().map_err(|e| e.into_error())?.sync_all()
    }
}

impl BlobStore for FsBlobs {
    fn open_read(&self, path: &Path) -> io::Result<Box<dyn Read>> {
        Ok(Box::new(File::open(path)?))
    }

    fn create_write(&self, path: &Path) -> io::Result<Box<dyn BlobWrite>> {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        Ok(Box::new(FsWriter(BufWriter::new(File::create(path)?))))
    }

    fn len(&self, path: &Path) -> io::Result<u64> {
        Ok(fs::metadata(path)?.len())
    }

    fn exists(&self, path: &Path) -> bool {
        path.exists()
    }

    fn create_dir_all(&self, dir: &Path) -> io::Result<()> {
        fs::create_dir_all(dir)
    }

    fn copy(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::copy(from, to).map(drop)
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::rename(from, to)
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }

    fn remove_dir(&self, dir: &Path) -> io::Result<()> {
        fs::remove_dir(dir)
    }

    fn remove_dir_all(&self, dir: &Path) -> io::Result<()> {
        fs::remove_dir_all(dir)
    }

    fn list_files(&self, dir: &Path) -> io::Result<Vec<PathBuf>> {
        let mut files = Vec::new();
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_file() {
                files.push(path);
            }
        }
        Ok(files)
    }
}

/// An in-memory [`BlobStore`] for `wasm32` workers and unit tests.
#[derive(Debug, Default, Clone)]
pub struct MemBlobs {
    files: Arc<Mutex<BTreeMap<PathBuf, Vec<u8>>>>,
}

struct MemWriter {
    files: Arc<Mutex<BTreeMap<PathBuf, Vec<u8>>>>,
    path: PathBuf,
    buf: Vec<u8>,
}

impl Write for MemWriter {
    fn write(&mut self, data: &[u8]) -> io::Result<usize> {
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl BlobWrite for MemWriter {
    fn finish(self: Box<Self>) -> io::Result<()> {
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        files.insert(self.path, self.buf);
        Ok(())
    }
}

impl MemBlobs {
    pub fn new() -> Self {
        Self::default()
    }

    /// Writes `bytes` at `path`.
    pub fn put(&self, path: impl Into<PathBuf>, bytes: impl Into<Vec<u8>>) {
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        files.insert(path.into(), bytes.into());
    }

    /// Reads the bytes at `path`, if any.
    pub fn get(&self, path: &Path) -> Option<Vec<u8>> {
        let files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        files.get(path).cloned()
    }
}

impl BlobStore for MemBlobs {
    fn open_read(&self, path: &Path) -> io::Result<Box<dyn Read>> {
        let files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        let bytes = files
            .get(path)
            .cloned()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "blob not found"))?;
        Ok(Box::new(Cursor::new(bytes)))
    }

    fn create_write(&self, path: &Path) -> io::Result<Box<dyn BlobWrite>> {
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        files.insert(path.to_path_buf(), Vec::new());
        Ok(Box::new(MemWriter {
            files: Arc::clone(&self.files),
            path: path.to_path_buf(),
            buf: Vec::new(),
        }))
    }

    fn len(&self, path: &Path) -> io::Result<u64> {
        let files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        files
            .get(path)
            .map(|b| b.len() as u64)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "blob not found"))
    }

    fn exists(&self, path: &Path) -> bool {
        let files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        files.contains_key(path)
    }

    fn create_dir_all(&self, _dir: &Path) -> io::Result<()> {
        Ok(())
    }

    fn copy(&self, from: &Path, to: &Path) -> io::Result<()> {
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        let bytes = files
            .get(from)
            .cloned()
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "blob not found"))?;
        files.insert(to.to_path_buf(), bytes);
        Ok(())
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        let bytes = files
            .remove(from)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "blob not found"))?;
        files.insert(to.to_path_buf(), bytes);
        Ok(())
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        files
            .remove(path)
            .map(drop)
            .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "blob not found"))
    }

    fn remove_dir(&self, _dir: &Path) -> io::Result<()> {
        Ok(())
    }

    fn remove_dir_all(&self, dir: &Path) -> io::Result<()> {
        let mut files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        files.retain(|k, _| !k.starts_with(dir));
        Ok(())
    }

    fn list_files(&self, dir: &Path) -> io::Result<Vec<PathBuf>> {
        let files = self.files.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(files
            .keys()
            .filter(|k| k.parent() == Some(dir))
            .cloned()
            .collect())
    }
}
