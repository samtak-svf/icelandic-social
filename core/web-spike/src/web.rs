//! The browser side: `Peer` behind wasm-bindgen, its store on
//! sqlite-wasm-rs's in-memory VFS (what rusqlite uses on wasm32).

use std::path::Path;

use wasm_bindgen::prelude::*;

use crate::{Error, Peer};

fn js(error: Error) -> JsError {
    JsError::new(&error.to_string())
}

#[wasm_bindgen]
pub struct WebPeer(Peer);

#[wasm_bindgen]
impl WebPeer {
    #[wasm_bindgen(constructor)]
    pub fn new(account: &str, device: &str) -> Result<WebPeer, JsError> {
        Peer::create(Path::new("spike"), account, device)
            .map(WebPeer)
            .map_err(js)
    }

    #[wasm_bindgen(js_name = storeIsEncrypted)]
    pub fn store_is_encrypted(&mut self) -> Result<bool, JsError> {
        self.0.store_is_encrypted().map_err(js)
    }

    /// Whether the store's file, read raw from the in-memory VFS, starts
    /// with SQLite's plaintext header. An encrypted file does not.
    #[wasm_bindgen(js_name = storeFileIsPlaintext)]
    pub fn store_file_is_plaintext() -> Result<bool, JsError> {
        let vfs = sqlite_wasm_rs::MemVfsUtil::<sqlite_wasm_rs::WasmOsCallback>::new();
        let name = vfs
            .list()
            .into_iter()
            .find(|name| name.ends_with(spjall_store::FILE_NAME))
            .ok_or_else(|| JsError::new("no store file"))?;
        let bytes = vfs
            .export_db(&name)
            .map_err(|e| JsError::new(&e.to_string()))?;
        Ok(bytes.starts_with(b"SQLite format 3\0"))
    }

    /// Whether `Store::open` on the same file with another key fails, as a
    /// wrong key must (0016).
    #[wasm_bindgen(js_name = wrongKeyFails)]
    pub fn wrong_key_fails() -> bool {
        spjall_store::Store::open(Path::new("spike"), &[8; 32]).is_err()
    }

    #[wasm_bindgen(js_name = keyPackage)]
    pub fn key_package(&mut self) -> Result<Vec<u8>, JsError> {
        self.0.key_package().map_err(js)
    }

    pub fn join(&mut self, welcome: &[u8]) -> Result<(), JsError> {
        self.0.join(welcome).map_err(js)
    }

    pub fn send(&mut self, id: &str, ts: f64, text: &str) -> Result<Vec<u8>, JsError> {
        self.0.send(id, ts as u64, text).map_err(js)
    }

    /// `[sender, text]`.
    pub fn receive(&mut self, message: &[u8]) -> Result<Vec<String>, JsError> {
        let (sender, text) = self.0.receive(message).map_err(js)?;
        Ok(vec![sender, text])
    }
}

/// What `spjall-client` asks of std that wasm32-unknown-unknown cannot give.
/// A panic there aborts (wasm traps), so each probe is its own call.
#[wasm_bindgen(js_name = probeFsWrite)]
pub fn probe_fs_write() -> String {
    match std::fs::write("probe", b"x") {
        Ok(()) => "ok".to_owned(),
        Err(error) => error.to_string(),
    }
}

#[wasm_bindgen(js_name = probeSystemTime)]
pub fn probe_system_time() {
    let _ = std::time::SystemTime::now();
}

#[wasm_bindgen(js_name = probeInstant)]
pub fn probe_instant() {
    let _ = std::time::Instant::now();
}
