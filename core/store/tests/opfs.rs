//! The store on `opfs-sahpool` in a dedicated Worker (decision 0081), under
//! headless Chrome: `cargo test --release -p spjall-store --features opfs
//! --target wasm32-unknown-unknown` with `wasm-bindgen-test-runner` as the
//! target's runner. Native builds compile nothing here.
//!
//! Release, not debug: `sqlite-wasm-vfs` 0.2.0 asserts in `xClose` that a file
//! being closed was open, and sqlite3mc opens the same database file twice
//! through the VFS it wraps, which the crate's `open_files` set cannot tell
//! apart. The assert is the crate's, not a finding about this store: every
//! assertion in this file holds in either profile, and release is what the
//! browser runs.
#![cfg(all(target_arch = "wasm32", target_os = "unknown", feature = "opfs"))]

use std::path::Path;

use spjall_store::{FILE_NAME, Key, Store, install_opfs, wipe_opfs};
use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

wasm_bindgen_test_configure!(run_in_dedicated_worker);

const POOL: &str = "spjall-store-test";
const KEY: Key = [7; 32];

/// A pool with nothing in it, so no test reads what another left.
async fn fresh_pool() {
    install_opfs(POOL).await.expect("install the pool");
    wipe_opfs(POOL).await.expect("wipe the pool");
}

fn put(store: &mut Store, key: &[u8], value: &[u8]) {
    store
        .write(|tx| tx.execute("INSERT INTO kv (key, value) VALUES (?1, ?2)", (key, value)))
        .expect("write a row");
}

fn count(store: &Store) -> u32 {
    let mut reader = store.reader().expect("open a reader");
    reader
        .read(|tx| tx.query_row("SELECT COUNT(*) FROM kv", [], |row| row.get::<_, u32>(0)))
        .expect("read")
}

#[wasm_bindgen_test]
async fn a_row_survives_closing_and_reacquiring_the_pool() {
    fresh_pool().await;
    let dir = Path::new("/");
    let mut store = Store::open(dir, &KEY).expect("open");
    put(&mut store, b"k", b"v");
    drop(store);

    // Pausing gives every access handle back to OPFS and unpausing takes
    // them again, so the reopen below reads the file, not a cache.
    let pool = install_opfs(POOL).await.expect("the installed pool");
    pool.pause_vfs().expect("pause");
    pool.unpause_vfs().await.expect("unpause");

    let store = Store::open(dir, &KEY).expect("reopen");
    let value: Vec<u8> = store
        .reader()
        .expect("reader")
        .read(|tx| {
            tx.query_row("SELECT value FROM kv WHERE key = ?1", [b"k"], |row| {
                row.get(0)
            })
        })
        .expect("the row");
    assert_eq!(value, b"v");
}

#[wasm_bindgen_test]
async fn a_wrong_key_does_not_open_the_store() {
    fresh_pool().await;
    let dir = Path::new("/");
    drop(Store::open(dir, &KEY).expect("open"));
    assert!(Store::open(dir, &[8; 32]).is_err());
}

#[wasm_bindgen_test]
async fn the_journal_is_truncate() {
    // 0081: the pool has no shared memory, so WAL cannot open here, and the
    // store asks for TRUNCATE and refuses anything else rather than running on.
    fresh_pool().await;
    let store = Store::open(Path::new("/"), &KEY).expect("open");
    let mode: String = store
        .reader()
        .expect("reader")
        .read(|tx| tx.query_row("PRAGMA journal_mode", [], |row| row.get(0)))
        .expect("the journal mode");
    assert_eq!(mode.to_lowercase(), "truncate");
}

#[wasm_bindgen_test]
async fn the_file_in_the_pool_is_not_plaintext() {
    fresh_pool().await;
    let mut store = Store::open(Path::new("/"), &KEY).expect("open");
    put(&mut store, b"k", b"a value written in plaintext would show");
    drop(store);

    let pool = install_opfs(POOL).await.expect("the installed pool");
    let bytes = pool
        .export_db(&format!("/{FILE_NAME}"))
        .expect("the store's file");
    assert!(bytes.len() > 4096, "the file has pages: {}", bytes.len());
    assert!(!bytes.starts_with(b"SQLite format 3\0"));
    let needle = b"a value written in plaintext";
    assert!(!bytes.windows(needle.len()).any(|window| window == needle));
}

#[wasm_bindgen_test]
async fn a_reader_reads_while_a_write_is_open() {
    fresh_pool().await;
    let mut store = Store::open(Path::new("/"), &KEY).expect("open");
    put(&mut store, b"before", b"1");
    let mut reader = store.reader().expect("open a reader");

    let seen = store
        .write(|tx| {
            tx.execute("INSERT INTO kv (key, value) VALUES (x'01', x'02')", [])?;
            // The open write is not committed, so the reader sees the one
            // row from before it.
            reader.read(|read| {
                read.query_row("SELECT COUNT(*) FROM kv", [], |row| row.get::<_, u32>(0))
            })
        })
        .expect("read inside the write");
    assert_eq!(seen, 1);
    assert_eq!(count(&store), 2);
}
