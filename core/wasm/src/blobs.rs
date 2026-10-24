//! Blobs as rows of a second encrypted database in the store's pool (0081).
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use spjall_client::{BlobStore, BlobWrite};
use spjall_store::Key;

#[derive(Clone)]
pub struct PoolBlobs;

impl PoolBlobs {
    pub fn open(_path: &Path, _key: &Key) -> io::Result<Self> {
        unimplemented!()
    }
}

impl BlobStore for PoolBlobs {
    fn open_read(&self, _: &Path) -> io::Result<Box<dyn Read>> {
        unimplemented!()
    }
    fn create_write(&self, _: &Path) -> io::Result<Box<dyn BlobWrite>> {
        unimplemented!()
    }
    fn len(&self, _: &Path) -> io::Result<u64> {
        unimplemented!()
    }
    fn exists(&self, _: &Path) -> bool {
        unimplemented!()
    }
    fn create_dir_all(&self, _: &Path) -> io::Result<()> {
        unimplemented!()
    }
    fn copy(&self, _: &Path, _: &Path) -> io::Result<()> {
        unimplemented!()
    }
    fn rename(&self, _: &Path, _: &Path) -> io::Result<()> {
        unimplemented!()
    }
    fn remove_file(&self, _: &Path) -> io::Result<()> {
        unimplemented!()
    }
    fn remove_dir(&self, _: &Path) -> io::Result<()> {
        unimplemented!()
    }
    fn remove_dir_all(&self, _: &Path) -> io::Result<()> {
        unimplemented!()
    }
    fn list_files(&self, _: &Path) -> io::Result<Vec<PathBuf>> {
        unimplemented!()
    }
}
