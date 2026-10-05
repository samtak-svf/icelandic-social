//! The envelope is the plaintext of every MLS application message (0002).
//!
//! It is JSON: `{"v":1,"id":"…","ts":…,"kind":"text",…}`. The server never
//! sees it, so every chat feature that lives here (edit, delete, reactions,
//! the disappearing timer, receipts, typing) is invisible to the delivery
//! service (0009).
//!
//! Compatibility rules, so old clients survive new ones:
//!
//! - A `kind` this client does not know decodes to [`Body::Unknown`], which the
//!   apps skip. Adding a kind never needs a version bump.
//! - Fields a client does not know are ignored, so adding an optional field
//!   never needs a version bump either.
//! - `v` changes only when an existing kind changes meaning. A higher `v` is
//!   [`EnvelopeError::UnsupportedVersion`], and `minClientVersion` from
//!   `/health` is what moves old clients forward.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// The envelope version this client writes and the highest it reads.
pub const VERSION: u32 = 1;

/// One decrypted application message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Envelope {
    /// The sender's message id (`clientMsgId`), unique per sender. Edits,
    /// deletes, reactions, replies and receipts point at it.
    pub id: String,
    /// When the sender wrote it, in milliseconds since the Unix epoch, by the
    /// sender's clock. Ordering uses the conversation `seq`, never this.
    pub ts: u64,
    pub body: Body,
}

/// What the message is. Serialized as the `kind` tag next to `v`, `id`, `ts`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Body {
    Text {
        text: String,
    },
    /// An attachment. The bytes are encrypted with `key` and uploaded to the
    /// media bucket under `object`; the server sees only ciphertext.
    Media {
        object: String,
        mime: String,
        size: u64,
        /// Base64 of the per-file key.
        key: String,
        /// Hex SHA-256 of the ciphertext, checked after download.
        sha256: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        caption: Option<String>,
    },
    Reply {
        to: String,
        text: String,
    },
    /// Replaces the text of `target`. Edit history stays on the device.
    Edit {
        target: String,
        text: String,
    },
    /// Delete for everyone: `target` becomes a tombstone.
    Delete {
        target: String,
    },
    /// Adds `emoji` to `target`, or removes it when `remove` is true.
    Reaction {
        target: String,
        emoji: String,
        #[serde(default)]
        remove: bool,
    },
    /// Sets the conversation's disappearing timer; `None` turns it off.
    Disappearing {
        seconds: Option<u32>,
    },
    /// Read marker: everything up to and including `up_to` has been read.
    Receipt {
        up_to: String,
    },
    /// Ephemeral; the delivery service forwards it and never stores it.
    Typing {
        active: bool,
    },
    /// A kind this client does not know. Never encoded.
    #[serde(skip)]
    Unknown {
        kind: String,
    },
}

const KNOWN_KINDS: &[&str] = &[
    "text",
    "media",
    "reply",
    "edit",
    "delete",
    "reaction",
    "disappearing",
    "receipt",
    "typing",
];

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EnvelopeError {
    #[error("envelope v{0} is newer than this client reads (v{VERSION})")]
    UnsupportedVersion(u32),
    #[error("an unknown kind cannot be encoded")]
    EncodeUnknown,
    #[error("malformed envelope: {0}")]
    Malformed(String),
}

#[derive(Serialize, Deserialize)]
struct Header {
    v: u32,
    id: String,
    ts: u64,
    kind: String,
}

impl Envelope {
    pub fn encode(&self) -> Result<Vec<u8>, EnvelopeError> {
        if matches!(self.body, Body::Unknown { .. }) {
            return Err(EnvelopeError::EncodeUnknown);
        }
        let mut object = match serde_json::to_value(&self.body) {
            Ok(Value::Object(object)) => object,
            Ok(_) => unreachable!("an internally tagged enum serializes to an object"),
            Err(error) => return Err(EnvelopeError::Malformed(error.to_string())),
        };
        object.insert("v".into(), VERSION.into());
        object.insert("id".into(), self.id.clone().into());
        object.insert("ts".into(), self.ts.into());
        serde_json::to_vec(&object).map_err(|error| EnvelopeError::Malformed(error.to_string()))
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, EnvelopeError> {
        let malformed = |error: serde_json::Error| EnvelopeError::Malformed(error.to_string());
        let mut object: Map<String, Value> = serde_json::from_slice(bytes).map_err(malformed)?;
        let header: Header =
            serde_json::from_value(Value::Object(object.clone())).map_err(malformed)?;
        if header.v > VERSION {
            return Err(EnvelopeError::UnsupportedVersion(header.v));
        }
        let body = if KNOWN_KINDS.contains(&header.kind.as_str()) {
            for key in ["v", "id", "ts"] {
                object.remove(key);
            }
            serde_json::from_value(Value::Object(object)).map_err(malformed)?
        } else {
            Body::Unknown { kind: header.kind }
        };
        Ok(Self {
            id: header.id,
            ts: header.ts,
            body,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    fn decode_str(json: &str) -> Result<Envelope, EnvelopeError> {
        Envelope::decode(json.as_bytes())
    }

    #[test]
    fn known_kinds_lists_every_variant() {
        let samples = [
            Body::Text {
                text: String::new(),
            },
            Body::Media {
                object: String::new(),
                mime: String::new(),
                size: 0,
                key: String::new(),
                sha256: String::new(),
                caption: None,
            },
            Body::Reply {
                to: String::new(),
                text: String::new(),
            },
            Body::Edit {
                target: String::new(),
                text: String::new(),
            },
            Body::Delete {
                target: String::new(),
            },
            Body::Reaction {
                target: String::new(),
                emoji: String::new(),
                remove: false,
            },
            Body::Disappearing { seconds: None },
            Body::Receipt {
                up_to: String::new(),
            },
            Body::Typing { active: false },
        ];
        let kinds: Vec<String> = samples
            .iter()
            .map(|body| {
                serde_json::to_value(body).unwrap()["kind"]
                    .as_str()
                    .unwrap()
                    .to_owned()
            })
            .collect();
        assert_eq!(kinds, KNOWN_KINDS);
    }

    #[test]
    fn wire_shape_is_flat_and_camel_case() {
        let envelope = Envelope {
            id: "m1".into(),
            ts: 7,
            body: Body::Receipt { up_to: "m0".into() },
        };
        let value: Value = serde_json::from_slice(&envelope.encode().unwrap()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"v": 1, "id": "m1", "ts": 7, "kind": "receipt", "upTo": "m0"})
        );
    }

    #[test]
    fn unknown_kind_decodes_to_unknown() {
        let decoded = decode_str(r#"{"v":1,"id":"m","ts":1,"kind":"poll","options":["a"]}"#);
        assert_eq!(
            decoded.unwrap().body,
            Body::Unknown {
                kind: "poll".into()
            }
        );
    }

    #[test]
    fn unknown_fields_are_ignored() {
        let decoded = decode_str(r#"{"v":1,"id":"m","ts":1,"kind":"text","text":"hæ","font":"x"}"#);
        assert_eq!(decoded.unwrap().body, Body::Text { text: "hæ".into() });
    }

    #[test]
    fn older_version_is_read() {
        let decoded = decode_str(r#"{"v":0,"id":"m","ts":1,"kind":"typing","active":true}"#);
        assert_eq!(decoded.unwrap().body, Body::Typing { active: true });
    }

    #[test]
    fn newer_version_is_refused() {
        let decoded = decode_str(r#"{"v":2,"id":"m","ts":1,"kind":"text","text":"x"}"#);
        assert_eq!(decoded, Err(EnvelopeError::UnsupportedVersion(2)));
    }

    #[test]
    fn missing_header_is_malformed() {
        assert!(matches!(
            decode_str(r#"{"kind":"text","text":"x"}"#),
            Err(EnvelopeError::Malformed(_))
        ));
        assert!(matches!(decode_str("[]"), Err(EnvelopeError::Malformed(_))));
        assert!(matches!(
            decode_str(r#"{"v":1,"id":"m","ts":1,"kind":"text"}"#),
            Err(EnvelopeError::Malformed(_))
        ));
    }

    #[test]
    fn unknown_is_never_encoded() {
        let envelope = Envelope {
            id: "m".into(),
            ts: 1,
            body: Body::Unknown {
                kind: "poll".into(),
            },
        };
        assert_eq!(envelope.encode(), Err(EnvelopeError::EncodeUnknown));
    }

    fn body() -> impl Strategy<Value = Body> {
        let s = || any::<String>();
        prop_oneof![
            s().prop_map(|text| Body::Text { text }),
            (s(), s(), any::<u64>(), s(), s(), proptest::option::of(s())).prop_map(
                |(object, mime, size, key, sha256, caption)| Body::Media {
                    object,
                    mime,
                    size,
                    key,
                    sha256,
                    caption
                }
            ),
            (s(), s()).prop_map(|(to, text)| Body::Reply { to, text }),
            (s(), s()).prop_map(|(target, text)| Body::Edit { target, text }),
            s().prop_map(|target| Body::Delete { target }),
            (s(), s(), any::<bool>()).prop_map(|(target, emoji, remove)| Body::Reaction {
                target,
                emoji,
                remove
            }),
            proptest::option::of(any::<u32>()).prop_map(|seconds| Body::Disappearing { seconds }),
            s().prop_map(|up_to| Body::Receipt { up_to }),
            any::<bool>().prop_map(|active| Body::Typing { active }),
        ]
    }

    proptest! {
        #[test]
        fn every_known_body_round_trips(id in any::<String>(), ts in any::<u64>(), body in body()) {
            let envelope = Envelope { id, ts, body };
            prop_assert_eq!(Envelope::decode(&envelope.encode().unwrap()).unwrap(), envelope);
        }

        #[test]
        fn arbitrary_bytes_never_panic(bytes in proptest::collection::vec(any::<u8>(), 0..256)) {
            let _ = Envelope::decode(&bytes);
        }
    }
}
