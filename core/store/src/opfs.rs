//! The store in the browser's Origin Private File System (decision 0081):
//! SQLite's `opfs-sahpool` VFS from `sqlite-wasm-vfs`, which keeps a pool of
//! `FileSystemSyncAccessHandle`s and so runs only in a dedicated Worker.
//!
//! Getting the handles is asynchronous, so the worker awaits `install_opfs`
//! once before its first `Store::open`, which stays synchronous. The pool is
//! then SQLite's default VFS, and `Store::open(Path::new("/"), key)` opens
//! `/spjall.db` in it under the same `PRAGMA key` as on a phone.

use std::ffi::CString;

use sqlite_wasm_rs::{
    SQLITE_OK, WasmOsCallback, sqlite3_vfs_find, sqlite3_vfs_register, sqlite3mc_vfs_create,
};
pub use sqlite_wasm_vfs::sahpool::{OpfsSAHError as OpfsError, OpfsSAHPoolUtil as OpfsPool};
use sqlite_wasm_vfs::sahpool::{OpfsSAHPoolCfgBuilder, install};

/// sqlite3mc's prefix for the VFS it wraps around another one.
const CIPHER_VFS_PREFIX: &str = "multipleciphers-";

/// Installs the pool named `pool_name`, in the OPFS directory of the same
/// name, and makes SQLite's default VFS sqlite3mc's cipher over it, and
/// returns the pool's handle. A second call with the same name returns the
/// pool already installed.
pub async fn install_opfs(pool_name: &str) -> Result<OpfsPool, OpfsError> {
    let config = OpfsSAHPoolCfgBuilder::new()
        .vfs_name(pool_name)
        .directory(pool_name)
        .build();
    let pool = install::<WasmOsCallback>(&config, false).await?;
    encrypt_by_default(pool_name)?;
    Ok(pool)
}

/// Deletes every file in the pool, its stores included: what sign-out and an
/// expired session leave behind (0064). Every `Store` and `Reader` on the
/// pool must be dropped first; the pool refuses otherwise.
pub async fn wipe_opfs(pool_name: &str) -> Result<(), OpfsError> {
    install_opfs(pool_name).await?.clear_all().await
}

/// sqlite3mc wraps the default VFS once, when SQLite initialises, and that is
/// the in-memory one: a VFS registered later is used without a cipher, and
/// `PRAGMA key` on it fails ("Encryption is not supported by the VFS"). So
/// the pool gets its own wrapper, made once and registered as the default.
fn encrypt_by_default(pool_name: &str) -> Result<(), OpfsError> {
    let nul = |_| OpfsError::Generic(format!("a NUL in the pool name {pool_name:?}"));
    let real = CString::new(pool_name).map_err(nul)?;
    let wrapped = CString::new(format!("{CIPHER_VFS_PREFIX}{pool_name}")).map_err(nul)?;
    // SAFETY: both names are NUL-terminated strings that outlive the calls;
    // SQLite copies what it keeps. `sqlite3_vfs_register` is given a VFS
    // SQLite itself returned, which stays registered for the process.
    #[allow(unsafe_code)]
    let rc = unsafe {
        let existing = sqlite3_vfs_find(wrapped.as_ptr());
        if existing.is_null() {
            sqlite3mc_vfs_create(real.as_ptr(), 1)
        } else {
            sqlite3_vfs_register(existing, 1)
        }
    };
    if rc == SQLITE_OK {
        Ok(())
    } else {
        Err(OpfsError::Generic(format!(
            "the cipher over {pool_name:?} could not be registered: {rc}"
        )))
    }
}
