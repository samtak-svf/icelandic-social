//! The object the page's Worker holds. Names and shapes follow
//! `core/ffi/src/client.rs`; values are plain data (`serde-wasm-bindgen`),
//! errors are `{ code, message }`.
use std::path::Path;

use js_sys::{Object, Reflect, Uint8Array};
use serde::Serialize;
use serde_wasm_bindgen::Serializer;
use spjall_client::Client;
use spjall_client::ClientError;
use spjall_envelope::Body;
use spjall_store::{Key, install_opfs, wipe_opfs};
use wasm_bindgen::prelude::*;

use crate::blobs::PoolBlobs;
use crate::dto;
use crate::error::Failure;
use crate::qr;
use crate::xhr::XhrTransport;

/// The OPFS directory of the pool: the store, and the blobs beside it.
const POOL: &str = "spjall";
const BLOBS_FILE: &str = "/blobs.db";

#[wasm_bindgen(typescript_custom_section)]
const TS: &str = crate::types::TYPES;

fn serializer() -> Serializer {
    // `None` is `null`, never `undefined`; a struct is a plain object.
    Serializer::new()
        .serialize_missing_as_null(true)
        .serialize_maps_as_objects(true)
}

fn to_js<T: Serialize>(value: &T) -> JsValue {
    value.serialize(&serializer()).unwrap_or(JsValue::NULL)
}

fn fail(failure: Failure) -> JsValue {
    to_js(&failure)
}

fn answer<T: Serialize>(result: Result<T, ClientError>) -> Result<JsValue, JsValue> {
    result
        .map(|value| to_js(&value))
        .map_err(|error| fail(Failure::from(&error)))
}

fn key_of(bytes: &[u8]) -> Result<Key, JsValue> {
    Key::try_from(bytes).map_err(|_| fail(Failure::new("invalid", "the store key is 32 bytes")))
}

/// The core of one signed-in or linking browser.
#[wasm_bindgen]
pub struct Core {
    client: Client<XhrTransport>,
}

#[wasm_bindgen]
impl Core {
    /// Installs the pool once, opens the store and the blobs under `key`, and
    /// builds the client. Only in a dedicated Worker.
    pub async fn open(key: Vec<u8>) -> Result<Core, JsValue> {
        let key = key_of(&key)?;
        install_opfs(POOL)
            .await
            .map_err(|_| fail(Failure::storage("the browser's file store did not open")))?;
        let blobs = PoolBlobs::open(Path::new(BLOBS_FILE), &key)
            .map_err(|_| fail(Failure::storage("the blob store did not open")))?;
        let client = Client::open_with_blobs(
            Path::new("/"),
            &key,
            XhrTransport::new(blobs.clone()),
            Box::new(blobs),
        )
        .map_err(|error| fail(Failure::from(&error)))?;
        Ok(Core { client })
    }

    /// Deletes everything: the store, the blobs and the pool. Consumes the
    /// object, since the pool refuses while a connection is open.
    pub async fn wipe(self) -> Result<(), JsValue> {
        drop(self);
        wipe_opfs(POOL)
            .await
            .map_err(|_| fail(Failure::storage("the browser's file store did not wipe")))
    }

    /// Deletes the pool's files without opening a store: what is left when
    /// no key opens it, after a link that never completed or a key that is
    /// gone (0064). Nothing may hold the pool open.
    #[wasm_bindgen(js_name = wipeStore)]
    pub async fn wipe_store() -> Result<(), JsValue> {
        wipe_opfs(POOL)
            .await
            .map_err(|_| fail(Failure::storage("the browser's file store did not wipe")))
    }

    #[wasm_bindgen(js_name = beginLink, unchecked_return_type = "DeviceLink")]
    pub fn begin_link(&mut self) -> Result<JsValue, JsValue> {
        answer(self.client.begin_device_link().map(dto::DeviceLink::from))
    }

    #[wasm_bindgen(js_name = linkState, unchecked_return_type = "LinkState")]
    pub fn link_state(&mut self) -> Result<JsValue, JsValue> {
        answer(self.client.device_link_state().map(dto::LinkState::from))
    }

    /// `{ accountId, deviceId, historyExpected, storeKeyShare: Uint8Array }`.
    #[wasm_bindgen(js_name = completeLink, unchecked_return_type = "Enrolled")]
    pub fn complete_link(&mut self) -> Result<JsValue, JsValue> {
        let enrolled = self
            .client
            .complete_device_link()
            .map_err(|error| fail(Failure::from(&error)))?;
        let object = to_js(&dto::Enrolled {
            account_id: enrolled.signed_in.account.clone(),
            device_id: enrolled.signed_in.device.clone(),
            history_expected: enrolled.history_expected,
        });
        Reflect::set(
            &object,
            &"storeKeyShare".into(),
            &Uint8Array::from(enrolled.store_key_share.as_slice()),
        )
        .map_err(|_| fail(Failure::storage("the key share could not be returned")))?;
        Ok(object)
    }

    /// The number of messages imported from the approving phone's history.
    #[wasm_bindgen(js_name = receiveHistory, unchecked_return_type = "number")]
    pub fn receive_history(&mut self) -> Result<JsValue, JsValue> {
        answer(self.client.receive_linked_history())
    }

    /// `{ size, modules: Uint8Array }` for the page to draw.
    #[wasm_bindgen(js_name = linkQr, unchecked_return_type = "LinkQr")]
    pub fn link_qr(code: &str) -> Result<JsValue, JsValue> {
        let matrix = qr::link_qr(code)
            .map_err(|_| fail(Failure::new("invalid", "the code does not fit a QR code")))?;
        let object = Object::new();
        let set =
            |name: &str, value: &JsValue| Reflect::set(&object, &name.into(), value).map(|_| ());
        set("size", &JsValue::from_f64(matrix.size as f64))
            .and_then(|()| set("modules", &Uint8Array::from(matrix.modules.as_slice())))
            .map_err(|_| fail(Failure::storage("the QR code could not be returned")))?;
        Ok(object.into())
    }

    #[wasm_bindgen(unchecked_return_type = "Outcome")]
    pub fn sync(&mut self) -> Result<JsValue, JsValue> {
        answer(self.client.sync().map(dto::Outcome::from))
    }

    /// A frame the realtime socket delivered.
    #[wasm_bindgen(js_name = onFrame, unchecked_return_type = "Outcome")]
    pub fn on_frame(&mut self, text: &str) -> Result<JsValue, JsValue> {
        answer(self.client.on_frame(text).map(dto::Outcome::from))
    }

    #[wasm_bindgen(unchecked_return_type = "Conversation[]")]
    pub fn conversations(&mut self) -> Result<JsValue, JsValue> {
        answer(self.client.conversations().map(|list| {
            list.into_iter()
                .map(dto::Conversation::from)
                .collect::<Vec<_>>()
        }))
    }

    /// Up to `limit` items before the item `before` (a seq), oldest first:
    /// what a thread shows, the history a linked phone sent included. The
    /// newest page ends with what is still being sent.
    #[wasm_bindgen(unchecked_return_type = "Item[]")]
    pub fn timeline(
        &mut self,
        conversation_id: &str,
        before: Option<f64>,
        limit: u32,
    ) -> Result<JsValue, JsValue> {
        // A seq is far below 2^53, so a JS number holds it exactly.
        let before = before.map(|seq| seq as u64);
        answer(
            self.client
                .timeline(conversation_id, before, limit)
                .map(|list| list.into_iter().map(dto::Item::from).collect::<Vec<_>>()),
        )
    }

    /// Queues a text message; the envelope id.
    #[wasm_bindgen(unchecked_return_type = "string")]
    pub fn send(&mut self, conversation_id: &str, text: String) -> Result<JsValue, JsValue> {
        answer(self.client.send(
            conversation_id,
            Body::Text {
                text,
                forwarded: false,
            },
        ))
    }

    #[wasm_bindgen(unchecked_return_type = "Me")]
    pub fn me(&mut self) -> Result<JsValue, JsValue> {
        answer(self.client.me().map(dto::Me::from))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wasm_bindgen_test::{wasm_bindgen_test, wasm_bindgen_test_configure};

    wasm_bindgen_test_configure!(run_in_dedicated_worker);

    #[wasm_bindgen_test]
    async fn a_store_no_key_opens_is_wiped_without_opening_it() {
        Core::wipe_store().await.expect("a clean pool");
        let first = Core::open(vec![1; 32])
            .await
            .expect("a store under the first key");
        drop(first);
        assert!(
            Core::open(vec![2; 32]).await.is_err(),
            "another key does not open it"
        );
        Core::wipe_store()
            .await
            .expect("wiped while nothing holds it");
        let fresh = Core::open(vec![2; 32])
            .await
            .expect("a new store under the second key");
        fresh.wipe().await.expect("wiped");
    }
}
