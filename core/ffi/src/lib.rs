//! What the apps call. Phase 0 exposes just enough for each app to prove the
//! binary loads and works on the device: the version, the envelope codec, the
//! MLS self-test and the store.
//!
//! The records here mirror `spjall-envelope` so that crate stays free of FFI
//! concerns; `From` impls in both directions keep them in step, and the tests
//! round-trip every kind through them.

use std::path::Path;

use spjall_envelope as envelope;

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
            } => Self::Media {
                object,
                mime,
                size,
                key,
                sha256,
                caption,
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
            } => Self::Media {
                object,
                mime,
                size,
                key,
                sha256,
                caption,
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

/// Opens (creating if needed) the store in `dir`; returns its schema version.
#[uniffi::export]
pub fn store_self_test(dir: String) -> Result<u32, CoreError> {
    let store = |error: spjall_store::rusqlite::Error| CoreError::Store {
        detail: error.to_string(),
    };
    spjall_store::Store::open(Path::new(&dir))
        .and_then(|s| s.schema_version())
        .map_err(store)
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
    fn self_tests_pass() {
        assert_eq!(mls_self_test().unwrap(), 1);
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            store_self_test(dir.path().to_string_lossy().into_owned()).unwrap(),
            1
        );
    }

    #[test]
    fn version_is_the_workspace_version() {
        assert_eq!(core_version(), env!("CARGO_PKG_VERSION"));
    }
}
