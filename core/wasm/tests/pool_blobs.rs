//! `PoolBlobs` through the `BlobStore` seam. Natively over a temporary
//! database file; in headless Chrome over the OPFS pool, as the Worker runs it.
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use spjall_client::BlobStore;
use spjall_wasm::blobs::PoolBlobs;

const KEY: [u8; 32] = [9; 32];

fn put(blobs: &dyn BlobStore, path: &str, bytes: &[u8]) {
    let mut out = blobs.create_write(Path::new(path)).expect("create");
    out.write_all(bytes).expect("write");
    out.finish().expect("finish");
}

fn get(blobs: &dyn BlobStore, path: &str) -> Vec<u8> {
    let mut bytes = Vec::new();
    blobs
        .open_read(Path::new(path))
        .expect("open")
        .read_to_end(&mut bytes)
        .expect("read");
    bytes
}

fn every_method(blobs: &PoolBlobs) {
    // Write, read back, length, existence.
    assert!(!blobs.exists(Path::new("/m/a.bin")));
    put(blobs, "/m/a.bin", b"hello");
    assert!(blobs.exists(Path::new("/m/a.bin")));
    assert_eq!(get(blobs, "/m/a.bin"), b"hello");
    assert_eq!(blobs.len(Path::new("/m/a.bin")).unwrap(), 5);

    // A missing blob is NotFound, as on a file system.
    let missing = blobs
        .open_read(Path::new("/m/none"))
        .err()
        .expect("missing");
    assert_eq!(missing.kind(), std::io::ErrorKind::NotFound);
    assert_eq!(
        blobs.len(Path::new("/m/none")).unwrap_err().kind(),
        std::io::ErrorKind::NotFound
    );

    // Creating again truncates.
    put(blobs, "/m/a.bin", b"hi");
    assert_eq!(get(blobs, "/m/a.bin"), b"hi");

    // A writer that is dropped without `finish` leaves nothing.
    {
        let mut abandoned = blobs.create_write(Path::new("/m/b.bin")).unwrap();
        abandoned.write_all(b"half").unwrap();
    }
    assert!(!blobs.exists(Path::new("/m/b.bin")));

    // Copy keeps the source; rename does not.
    blobs
        .copy(Path::new("/m/a.bin"), Path::new("/m/c.bin"))
        .unwrap();
    assert_eq!(get(blobs, "/m/c.bin"), b"hi");
    blobs
        .rename(Path::new("/m/c.bin"), Path::new("/m/d.bin"))
        .unwrap();
    assert!(!blobs.exists(Path::new("/m/c.bin")));
    assert_eq!(get(blobs, "/m/d.bin"), b"hi");
    assert!(blobs.copy(Path::new("/m/none"), Path::new("/m/x")).is_err());

    // Directories are prefixes: only direct children are listed.
    put(blobs, "/m/sub/e.bin", b"e");
    blobs.create_dir_all(Path::new("/m/empty")).unwrap();
    let mut listed = blobs.list_files(Path::new("/m")).unwrap();
    listed.sort();
    assert_eq!(
        listed,
        vec![PathBuf::from("/m/a.bin"), PathBuf::from("/m/d.bin")]
    );
    // A sibling that shares the name's prefix is not inside the directory.
    put(blobs, "/m2/f.bin", b"f");
    assert_eq!(blobs.list_files(Path::new("/m")).unwrap().len(), 2);

    // Removing a file is quiet when it is already gone.
    blobs.remove_file(Path::new("/m/d.bin")).unwrap();
    blobs.remove_file(Path::new("/m/d.bin")).unwrap();
    assert!(!blobs.exists(Path::new("/m/d.bin")));

    // `remove_dir` takes an empty directory and no blob with it.
    blobs.remove_dir(Path::new("/m/empty")).unwrap();
    assert!(blobs.exists(Path::new("/m/a.bin")));

    // `remove_dir_all` takes the whole subtree and leaves the sibling.
    blobs.remove_dir_all(Path::new("/m")).unwrap();
    assert!(!blobs.exists(Path::new("/m/a.bin")));
    assert!(!blobs.exists(Path::new("/m/sub/e.bin")));
    assert!(blobs.exists(Path::new("/m2/f.bin")));
}

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use super::*;

    #[test]
    fn every_trait_method_works() {
        let dir = tempfile::tempdir().unwrap();
        let blobs = PoolBlobs::open(&dir.path().join("blobs.db"), &KEY).unwrap();
        every_method(&blobs);
    }

    #[test]
    fn blobs_survive_a_reopen_under_the_same_key_and_not_under_another() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("blobs.db");
        put(&PoolBlobs::open(&path, &KEY).unwrap(), "/k/a", b"kept");
        assert_eq!(get(&PoolBlobs::open(&path, &KEY).unwrap(), "/k/a"), b"kept");
        assert!(PoolBlobs::open(&path, &[1; 32]).is_err());
    }

    #[test]
    fn a_handle_cloned_for_the_transport_sees_the_same_blobs() {
        let dir = tempfile::tempdir().unwrap();
        let blobs = PoolBlobs::open(&dir.path().join("blobs.db"), &KEY).unwrap();
        let other = blobs.clone();
        put(&blobs, "/s/a", b"shared");
        assert_eq!(get(&other, "/s/a"), b"shared");
    }
}

#[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
mod browser {
    use super::*;
    use spjall_store::{install_opfs, wipe_opfs};
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_dedicated_worker);

    const POOL: &str = "spjall-wasm-test";

    #[wasm_bindgen_test]
    async fn every_trait_method_works_in_the_pool() {
        install_opfs(POOL).await.expect("install");
        wipe_opfs(POOL).await.expect("wipe");
        let blobs = PoolBlobs::open(Path::new("/blobs.db"), &KEY).expect("open");
        every_method(&blobs);
    }
}
