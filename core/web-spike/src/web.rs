//! The browser side: `Peer` behind wasm-bindgen, its store on
//! sqlite-wasm-rs's in-memory VFS (what rusqlite uses on wasm32), and the
//! `spjall-client` worker suite (#298).

use std::path::Path;
use std::sync::{Arc, Mutex};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;
use spjall_client::{Client, Content, MemBlobs};
use spjall_envelope::Body;
use wasm_bindgen::prelude::*;

use crate::relay::{MiniRelay, WorkerTransport};
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

/// Runs the `spjall-client` suite on `wasm32` over `MemBlobs` and the single
/// connection `shared_reader` (`0056`, `0064`, `#298`).
#[wasm_bindgen(js_name = runClientWorkerSuite)]
pub fn run_client_worker_suite() -> Result<(), JsError> {
    let relay = Arc::new(Mutex::new(MiniRelay::default()));
    let blobs_a = MemBlobs::new();
    let blobs_b = MemBlobs::new();
    let transport_a = WorkerTransport {
        account: "a_alice".into(),
        device: "d_1".into(),
        blobs: blobs_a.clone(),
        relay: Arc::clone(&relay),
    };
    let transport_b = WorkerTransport {
        account: "a_bob".into(),
        device: "d_2".into(),
        blobs: blobs_b.clone(),
        relay: Arc::clone(&relay),
    };
    let mut alice = Client::open_with_blobs(
        Path::new("worker-alice"),
        &[11; 32],
        transport_a,
        Box::new(blobs_a.clone()),
    )
    .map_err(|e| JsError::new(&e.to_string()))?;
    let mut bob = Client::open_with_blobs(
        Path::new("worker-bob"),
        &[12; 32],
        transport_b,
        Box::new(blobs_b.clone()),
    )
    .map_err(|e| JsError::new(&e.to_string()))?;

    alice
        .enrol_linked("a_alice", "d_1", "tok_alice")
        .map_err(|e| JsError::new(&e.to_string()))?;
    bob.enrol_linked("a_bob", "d_2", "tok_bob")
        .map_err(|e| JsError::new(&e.to_string()))?;
    bob.stock_key_packages(2)
        .map_err(|e| JsError::new(&e.to_string()))?;

    let conv = alice
        .create_conversation(&["a_bob".into()])
        .map_err(|e| JsError::new(&e.to_string()))?;
    alice.sync().map_err(|e| JsError::new(&e.to_string()))?;

    alice
        .send(
            &conv,
            Body::Text {
                text: "Sæll úr Web Worker".into(),
                forwarded: false,
            },
        )
        .map_err(|e| JsError::new(&e.to_string()))?;

    let src_file = Path::new("upload/mynd.webp");
    let payload = b"dulkodud mynd i vafra".to_vec();
    blobs_a.put(src_file, payload.clone());
    alice
        .send_media(
            &conv,
            src_file,
            "image/webp",
            Some("Myndatexti".into()),
            Some("mynd.webp".into()),
        )
        .map_err(|e| JsError::new(&e.to_string()))?;
    alice.sync().map_err(|e| JsError::new(&e.to_string()))?;

    let joined = bob
        .on_frame(
            &serde_json::json!({ "type": "notify", "conversationId": conv, "seq": 2 }).to_string(),
        )
        .map_err(|e| JsError::new(&e.to_string()))?;
    assert!(!joined.events.is_empty());

    // View reads on wasm32 use Store::shared_reader() (decision 0056).
    let mut view = bob.view().map_err(|e| JsError::new(&e.to_string()))?;
    assert_eq!(
        view.signed_in()
            .map_err(|e| JsError::new(&e.to_string()))?
            .map(|s| s.account),
        Some("a_bob".into())
    );
    let items = view
        .timeline(&conv, None, 20)
        .map_err(|e| JsError::new(&e.to_string()))?;
    assert!(items.iter().any(|i| matches!(
        &i.content,
        Content::Text { text, .. } if text == "Sæll úr Web Worker"
    )));
    let media_seq = items
        .iter()
        .find(|i| matches!(&i.content, Content::Media { .. }))
        .and_then(|i| i.seq)
        .ok_or_else(|| JsError::new("expected media item in timeline"))?;

    let decrypted_path = bob
        .media(&conv, media_seq)
        .map_err(|e| JsError::new(&e.to_string()))?;
    assert_eq!(blobs_b.get(&decrypted_path), Some(payload.clone()));

    // Profile photo and social post image through BlobStore.
    let photo_src = Path::new("upload/avatar.webp");
    blobs_a.put(photo_src, vec![1, 2, 3, 4]);
    let version = alice
        .set_photo(photo_src)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let fetched_photo = bob
        .photo("a_alice", &version)
        .map_err(|e| JsError::new(&e.to_string()))?
        .ok_or_else(|| JsError::new("expected photo path"))?;
    assert_eq!(blobs_b.get(&fetched_photo), Some(vec![1, 2, 3, 4]));

    let social_uploaded = alice
        .upload_social_media("cm_1", photo_src)
        .map_err(|e| JsError::new(&e.to_string()))?;
    let fetched_social = bob
        .post_media("p_1", &social_uploaded.media_id)
        .map_err(|e| JsError::new(&e.to_string()))?;
    assert_eq!(blobs_b.get(&fetched_social), Some(vec![1, 2, 3, 4]));

    // Revoking own device forgets the store and wipes its blobs.
    bob.revoke_device("d_2")
        .map_err(|e| JsError::new(&e.to_string()))?;
    assert_eq!(blobs_b.get(&decrypted_path), None);
    assert_eq!(blobs_b.get(&fetched_photo), None);
    let _ = STANDARD.encode(b"ok");
    Ok(())
}

/// A one-time key for receiving a history: 32 private bytes, then the 32
/// public ones the native side seals to.
#[wasm_bindgen(js_name = historyKey)]
pub fn history_key() -> Result<Vec<u8>, JsError> {
    let key = spjall_client::history_key().map_err(|e| JsError::new(&e.to_string()))?;
    Ok([key.private, key.public].concat())
}

/// Opens a history the native side sealed, in a new store of this side's
/// own, and returns its texts; throws unless its photo opened from the
/// history alone.
#[wasm_bindgen(js_name = importHistory)]
pub fn import_history(sealed: &[u8], private: &[u8]) -> Result<Vec<String>, JsError> {
    let (texts, photo) =
        crate::import_history(Path::new("imported"), sealed, private).map_err(js)?;
    if !photo {
        return Err(JsError::new("the photo did not come with the history"));
    }
    Ok(texts)
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
