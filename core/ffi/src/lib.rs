//! What the apps call: the version, the envelope codec, the MLS self-test,
//! the encrypted store, and the client of decision 0018 (`client`), which
//! the app drives over its own HTTP transport and WebSocket.
//!
//! The records here mirror `spjall-envelope` so that crate stays free of FFI
//! concerns; `From` impls in both directions keep them in step, and the tests
//! round-trip every kind through them.

use std::path::Path;
use std::sync::{Arc, Mutex};

use spjall_envelope as envelope;

pub mod client;
pub mod feed;

uniffi::setup_scaffolding!();

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    #[error("envelope v{version} is newer than this client reads")]
    UnsupportedVersion { version: u32 },
    #[error("{detail}")]
    Envelope { detail: String },
    #[error("{detail}")]
    Mls { detail: String },
    #[error("{detail}")]
    Store { detail: String },
    /// No answer came from the server; everything sent is safe to retry.
    #[error("{detail}")]
    Unreachable { detail: String },
    /// The server answered with an `ApiError` code. `request_id` is the
    /// server's id for the request (0037), for the person to quote to
    /// support; none from an older server.
    #[error("{status} {code}")]
    Refused {
        status: u16,
        code: String,
        request_id: Option<String>,
    },
    #[error("this device is not registered")]
    NotRegistered,
    #[error("no such conversation, or not one this device is in")]
    UnknownConversation,
    /// The app asked for something the client does not do.
    #[error("{detail}")]
    Invalid { detail: String },
    /// The server answered outside the contract.
    #[error("{detail}")]
    Protocol { detail: String },
    /// The sign-in did not finish: no sign-in was pending, the callback
    /// was not Kenni's, or Kenni answered with an error.
    #[error("sign-in: {detail}")]
    SignIn { detail: String },
    /// The file is over the 25 MB a message carries (0023).
    #[error("the file is over 25 MB")]
    TooLarge,
    /// A downloaded file is not the one that was sent (0023).
    #[error("the file was changed on the way")]
    Tampered,
    /// A file could not be read or written on this device.
    #[error("{detail}")]
    File { detail: String },
    /// This build is below the server's floor; the app asks the person to
    /// update to at least `min_version` (0030).
    #[error("this build is too old; the server needs {min_version}")]
    ClientTooOld { min_version: String },
}

impl From<envelope::EnvelopeError> for CoreError {
    fn from(error: envelope::EnvelopeError) -> Self {
        match error {
            envelope::EnvelopeError::UnsupportedVersion(version) => {
                Self::UnsupportedVersion { version }
            }
            other => Self::Envelope {
                detail: other.to_string(),
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Envelope {
    pub id: String,
    pub ts: u64,
    pub body: Body,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Body {
    Text {
        text: String,
    },
    Media {
        object: String,
        mime: String,
        size: u64,
        key: String,
        sha256: String,
        caption: Option<String>,
        name: Option<String>,
    },
    Reply {
        to: String,
        text: String,
    },
    Edit {
        target: String,
        text: String,
    },
    Delete {
        target: String,
    },
    Reaction {
        target: String,
        emoji: String,
        remove: bool,
    },
    Disappearing {
        seconds: Option<u32>,
    },
    Receipt {
        up_to: String,
    },
    Typing {
        active: bool,
    },
    /// A kind this client does not know; the app skips it.
    Unknown {
        kind: String,
    },
}

impl From<envelope::Body> for Body {
    fn from(body: envelope::Body) -> Self {
        use envelope::Body as B;
        match body {
            B::Text { text } => Self::Text { text },
            B::Media {
                object,
                mime,
                size,
                key,
                sha256,
                caption,
                name,
            } => Self::Media {
                object,
                mime,
                size,
                key,
                sha256,
                caption,
                name,
            },
            B::Reply { to, text } => Self::Reply { to, text },
            B::Edit { target, text } => Self::Edit { target, text },
            B::Delete { target } => Self::Delete { target },
            B::Reaction {
                target,
                emoji,
                remove,
            } => Self::Reaction {
                target,
                emoji,
                remove,
            },
            B::Disappearing { seconds } => Self::Disappearing { seconds },
            B::Receipt { up_to } => Self::Receipt { up_to },
            B::Typing { active } => Self::Typing { active },
            B::Unknown { kind } => Self::Unknown { kind },
        }
    }
}

impl From<Body> for envelope::Body {
    fn from(body: Body) -> Self {
        use Body as B;
        match body {
            B::Text { text } => Self::Text { text },
            B::Media {
                object,
                mime,
                size,
                key,
                sha256,
                caption,
                name,
            } => Self::Media {
                object,
                mime,
                size,
                key,
                sha256,
                caption,
                name,
            },
            B::Reply { to, text } => Self::Reply { to, text },
            B::Edit { target, text } => Self::Edit { target, text },
            B::Delete { target } => Self::Delete { target },
            B::Reaction {
                target,
                emoji,
                remove,
            } => Self::Reaction {
                target,
                emoji,
                remove,
            },
            B::Disappearing { seconds } => Self::Disappearing { seconds },
            B::Receipt { up_to } => Self::Receipt { up_to },
            B::Typing { active } => Self::Typing { active },
            B::Unknown { kind } => Self::Unknown { kind },
        }
    }
}

/// The core's version, shown on the skeleton screen and sent in diagnostics.
#[uniffi::export]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// The highest envelope version this core reads and the one it writes.
#[uniffi::export]
pub fn envelope_version() -> u32 {
    envelope::VERSION
}

#[uniffi::export]
pub fn envelope_encode(envelope: Envelope) -> Result<Vec<u8>, CoreError> {
    let inner = envelope::Envelope {
        id: envelope.id,
        ts: envelope.ts,
        body: envelope.body.into(),
    };
    Ok(inner.encode()?)
}

#[uniffi::export]
pub fn envelope_decode(bytes: Vec<u8>) -> Result<Envelope, CoreError> {
    let inner = envelope::Envelope::decode(&bytes)?;
    Ok(Envelope {
        id: inner.id,
        ts: inner.ts,
        body: inner.body.into(),
    })
}

/// Runs the two-member MLS round trip on this device; returns the epoch.
#[uniffi::export]
pub fn mls_self_test() -> Result<u64, CoreError> {
    spjall_mls::self_test().map_err(|error| CoreError::Mls {
        detail: error.to_string(),
    })
}

impl From<spjall_store::rusqlite::Error> for CoreError {
    fn from(error: spjall_store::rusqlite::Error) -> Self {
        Self::Store {
            detail: error.to_string(),
        }
    }
}

/// The core's encrypted store (decision 0016). Each process opens its own;
/// writes from the app and its extension serialize on the file's lock.
#[derive(uniffi::Object)]
pub struct CoreStore {
    store: Mutex<spjall_store::Store>,
}

#[uniffi::export]
impl CoreStore {
    /// Opens (creating if needed) `spjall.db` in `dir` with the platform's
    /// 32-byte key. A wrong key fails here.
    #[uniffi::constructor]
    pub fn open(dir: String, key: Vec<u8>) -> Result<Arc<Self>, CoreError> {
        let key: spjall_store::Key = key.try_into().map_err(|key: Vec<u8>| CoreError::Store {
            detail: format!("the store key must be 32 bytes, not {}", key.len()),
        })?;
        let store = spjall_store::Store::open(Path::new(&dir), &key)?;
        Ok(Arc::new(Self {
            store: Mutex::new(store),
        }))
    }

    /// The highest migration applied.
    pub fn schema_version(&self) -> Result<u32, CoreError> {
        Ok(self.store()?.schema_version()?)
    }
}

impl CoreStore {
    fn store(&self) -> Result<std::sync::MutexGuard<'_, spjall_store::Store>, CoreError> {
        self.store.lock().map_err(|_| CoreError::Store {
            detail: "the store lock is poisoned".into(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn every_kind() -> Vec<Body> {
        vec![
            Body::Text { text: "hæ".into() },
            Body::Media {
                object: "o".into(),
                mime: "image/jpeg".into(),
                size: 3,
                key: "k".into(),
                sha256: "00".into(),
                caption: Some("c".into()),
                name: Some("skýrsla.pdf".into()),
            },
            Body::Reply {
                to: "m0".into(),
                text: "já".into(),
            },
            Body::Edit {
                target: "m0".into(),
                text: "x".into(),
            },
            Body::Delete {
                target: "m0".into(),
            },
            Body::Reaction {
                target: "m0".into(),
                emoji: "👍".into(),
                remove: true,
            },
            Body::Disappearing {
                seconds: Some(86_400),
            },
            Body::Receipt { up_to: "m0".into() },
            Body::Typing { active: true },
        ]
    }

    #[test]
    fn every_kind_round_trips_through_the_ffi_records() {
        for body in every_kind() {
            let envelope = Envelope {
                id: "m1".into(),
                ts: 9,
                body,
            };
            let bytes = envelope_encode(envelope.clone()).unwrap();
            assert_eq!(envelope_decode(bytes).unwrap(), envelope);
        }
    }

    #[test]
    fn errors_keep_their_shape() {
        let newer = br#"{"v":99,"id":"m","ts":1,"kind":"text","text":"x"}"#.to_vec();
        assert!(matches!(
            envelope_decode(newer),
            Err(CoreError::UnsupportedVersion { version: 99 })
        ));
        let unknown = Envelope {
            id: "m".into(),
            ts: 1,
            body: Body::Unknown {
                kind: "poll".into(),
            },
        };
        assert!(matches!(
            envelope_encode(unknown),
            Err(CoreError::Envelope { .. })
        ));
    }

    #[test]
    fn mls_self_test_passes() {
        assert_eq!(mls_self_test().unwrap(), 1);
    }

    #[test]
    fn the_store_opens_with_its_key_only() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().into_owned();
        let store = CoreStore::open(path.clone(), vec![1; 32]).unwrap();
        assert_eq!(store.schema_version().unwrap(), 10);
        drop(store);
        assert!(matches!(
            CoreStore::open(path.clone(), vec![2; 32]),
            Err(CoreError::Store { .. })
        ));
        assert!(matches!(
            CoreStore::open(path, vec![1; 31]),
            Err(CoreError::Store { detail }) if detail.contains("32 bytes")
        ));
    }

    #[test]
    fn version_is_the_workspace_version() {
        assert_eq!(core_version(), env!("CARGO_PKG_VERSION"));
    }
}
