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
        /// A copy of another conversation's message, sent by `forward` (0041).
        /// Absent means false, so a reader older than the field shows it as
        /// ordinary text.
        #[serde(default, skip_serializing_if = "is_false")]
        forwarded: bool,
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
        /// The file's name on the sender's device, for a file row and a
        /// viewer; never a path to trust.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        name: Option<String>,
        /// A copy of another conversation's file, sealed under a fresh key
        /// and uploaded here (0041). Absent means false.
        #[serde(default, skip_serializing_if = "is_false")]
        forwarded: bool,
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
    /// A post shared into the conversation (0040): its id and nothing
    /// else. No client sends one since 0044, and the posts are deleted;
    /// it stays decodable so a conversation that holds one does not break.
    Post {
        post_id: String,
        /// Shared again by `forward` from another conversation (0041).
        /// Absent means false.
        #[serde(default, skip_serializing_if = "is_false")]
        forwarded: bool,
    },
    /// The place the sender's phone was when they sent it, once (0059).
    /// WGS 84 degrees times 10⁶, so the envelope never carries a float.
    Location {
        lat_e6: i32,
        lon_e6: i32,
        /// The fix's radius in whole metres; none when the system gave none.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        accuracy: Option<u32>,
        /// Forwarded from another conversation (0041). Absent means false.
        #[serde(default, skip_serializing_if = "is_false")]
        forwarded: bool,
    },
    /// Names the group, or clears its name with `None` (0078). Groups only:
    /// a 1:1 conversation is titled by the other person.
    Name {
        name: Option<String>,
    },
    /// The group's settings as the sender holds them, sent to whoever joined
    /// since (0078): a new account after an add, a new device after an
    /// external join. Folding one that changes nothing shows nothing.
    Settings {
        name: Option<String>,
        timer: Option<u32>,
    },
    /// The sender's account is leaving the group (0078); the server stops
    /// listing it, and the next member to check the devices removes its
    /// leaves.
    Leave {},
    /// A kind this client does not know. Never encoded.
    #[serde(skip)]
    Unknown {
        kind: String,
    },
}

fn is_false(value: &bool) -> bool {
    !*value
}

/// Whether a `location` names a point on the globe: a latitude within ±90°
/// and a longitude within ±180°. Nothing out of range is sent or shown (0059).
pub fn is_place(lat_e6: i32, lon_e6: i32) -> bool {
    (-90_000_000..=90_000_000).contains(&lat_e6) && (-180_000_000..=180_000_000).contains(&lon_e6)
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
    "post",
    "location",
    "name",
    "settings",
    "leave",
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

impl EnvelopeError {
    /// Its code in the vocabulary of 0049: fixed words, never the input.
    pub fn code(&self) -> String {
        match self {
            Self::UnsupportedVersion(version) => format!("envelope/v{version}"),
            Self::EncodeUnknown => "envelope/encode-unknown".into(),
            Self::Malformed(_) => "envelope/malformed".into(),
        }
    }
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
        Self::decode_known(bytes, KNOWN_KINDS)
    }

    /// `decode` by a reader that knows only `known`; a test plays an
    /// older client with it.
    fn decode_known(bytes: &[u8], known: &[&str]) -> Result<Self, EnvelopeError> {
        let malformed = |error: serde_json::Error| EnvelopeError::Malformed(error.to_string());
        let mut object: Map<String, Value> = serde_json::from_slice(bytes).map_err(malformed)?;
        let header: Header =
            serde_json::from_value(Value::Object(object.clone())).map_err(malformed)?;
        if header.v > VERSION {
            return Err(EnvelopeError::UnsupportedVersion(header.v));
        }
        let body = if known.contains(&header.kind.as_str()) {
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
                forwarded: false,
            },
            Body::Media {
                object: String::new(),
                mime: String::new(),
                size: 0,
                key: String::new(),
                sha256: String::new(),
                caption: None,
                name: None,
                forwarded: false,
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
            Body::Post {
                post_id: String::new(),
                forwarded: false,
            },
            Body::Location {
                lat_e6: 0,
                lon_e6: 0,
                accuracy: None,
                forwarded: false,
            },
            Body::Name { name: None },
            Body::Settings {
                name: None,
                timer: None,
            },
            Body::Leave {},
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
        assert_eq!(
            decoded.unwrap().body,
            Body::Text {
                text: "hæ".into(),
                forwarded: false
            }
        );
    }

    /// An envelope from before 0041 has no `forwarded`: it reads as not
    /// forwarded, and one that is not forwarded is written without it, so
    /// its bytes are what an older client wrote.
    #[test]
    fn forwarded_is_absent_unless_set() {
        let old = r#"{"v":1,"id":"m","ts":1,"kind":"text","text":"hæ"}"#;
        let decoded = decode_str(old).unwrap();
        assert_eq!(
            decoded.body,
            Body::Text {
                text: "hæ".into(),
                forwarded: false
            }
        );
        let value: Value = serde_json::from_slice(&decoded.encode().unwrap()).unwrap();
        assert_eq!(value.get("forwarded"), None);

        let forwarded = Envelope {
            body: Body::Text {
                text: "hæ".into(),
                forwarded: true,
            },
            ..decoded
        };
        let value: Value = serde_json::from_slice(&forwarded.encode().unwrap()).unwrap();
        assert_eq!(value["forwarded"], true);
    }

    /// A reader from before 0041 skips the field it does not know and shows
    /// the text: a forward is never lost on an older client (0041).
    #[test]
    fn a_reader_without_the_field_still_reads_a_forward() {
        #[derive(Deserialize, PartialEq, Debug)]
        #[serde(tag = "kind", rename_all = "snake_case")]
        enum OldBody {
            Text { text: String },
        }
        let forwarded = Envelope {
            id: "m".into(),
            ts: 1,
            body: Body::Text {
                text: "hæ".into(),
                forwarded: true,
            },
        };
        let old: OldBody = serde_json::from_slice(&forwarded.encode().unwrap()).unwrap();
        assert_eq!(old, OldBody::Text { text: "hæ".into() });
    }

    /// A share holds the post's id and no other field but the forward
    /// mark: a copy of its text or its author's name would outlive a
    /// deletion (0040).
    #[test]
    fn a_shared_post_carries_only_its_id() {
        let envelope = Envelope {
            id: "m1".into(),
            ts: 7,
            body: Body::Post {
                post_id: "p_1".into(),
                forwarded: false,
            },
        };
        let value: Value = serde_json::from_slice(&envelope.encode().unwrap()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"v": 1, "id": "m1", "ts": 7, "kind": "post", "postId": "p_1"})
        );
        // Shared again by a forward (0041): the mark, and still nothing
        // of the post.
        let forwarded = Envelope {
            body: Body::Post {
                post_id: "p_1".into(),
                forwarded: true,
            },
            ..envelope
        };
        let value: Value = serde_json::from_slice(&forwarded.encode().unwrap()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"v": 1, "id": "m1", "ts": 7, "kind": "post", "postId": "p_1", "forwarded": true})
        );
    }

    /// A location is two integers and the accuracy; a fix without one, and
    /// one not forwarded, is written without the field (0059).
    #[test]
    fn a_location_is_integer_microdegrees() {
        let envelope = Envelope {
            id: "m1".into(),
            ts: 7,
            body: Body::Location {
                lat_e6: 64_141_960,
                lon_e6: -21_926_570,
                accuracy: Some(12),
                forwarded: false,
            },
        };
        let value: Value = serde_json::from_slice(&envelope.encode().unwrap()).unwrap();
        assert_eq!(
            value,
            serde_json::json!({"v": 1, "id": "m1", "ts": 7, "kind": "location",
                "latE6": 64_141_960, "lonE6": -21_926_570, "accuracy": 12})
        );
        let bare = decode_str(r#"{"v":1,"id":"m","ts":1,"kind":"location","latE6":1,"lonE6":2}"#);
        assert_eq!(
            bare.unwrap().body,
            Body::Location {
                lat_e6: 1,
                lon_e6: 2,
                accuracy: None,
                forwarded: false
            }
        );
        // A float is not a place this format writes: malformed, not rounded.
        assert!(matches!(
            decode_str(r#"{"v":1,"id":"m","ts":1,"kind":"location","latE6":1.5,"lonE6":2}"#),
            Err(EnvelopeError::Malformed(_))
        ));
    }

    #[test]
    fn a_place_is_within_the_globe() {
        assert!(is_place(90_000_000, -180_000_000));
        assert!(is_place(-90_000_000, 180_000_000));
        assert!(!is_place(90_000_001, 0));
        assert!(!is_place(0, -180_000_001));
        assert!(!is_place(i32::MIN, 0));
    }

    /// A reader from before 0059 decodes a location to `Unknown`, which the
    /// apps skip, never to an error that would stall the conversation.
    #[test]
    fn a_reader_before_locations_skips_one() {
        let older: Vec<&str> = KNOWN_KINDS
            .iter()
            .copied()
            .filter(|k| *k != "location")
            .collect();
        let location = br#"{"v":1,"id":"m","ts":1,"kind":"location","latE6":1,"lonE6":2}"#;
        assert_eq!(
            Envelope::decode_known(location, &older).unwrap().body,
            Body::Unknown {
                kind: "location".into()
            }
        );
    }

    /// A reader from before 0040 decodes a share to `Unknown`, which the
    /// apps skip, never to an error that would stall the conversation.
    #[test]
    fn a_reader_without_the_kind_skips_a_shared_post() {
        let shared = Envelope {
            id: "m".into(),
            ts: 1,
            body: Body::Post {
                post_id: "p_1".into(),
                forwarded: false,
            },
        }
        .encode()
        .unwrap();
        let older: Vec<&str> = KNOWN_KINDS
            .iter()
            .copied()
            .filter(|k| *k != "post")
            .collect();
        assert_eq!(
            Envelope::decode_known(&shared, &older).unwrap().body,
            Body::Unknown {
                kind: "post".into()
            }
        );
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
            (s(), any::<bool>()).prop_map(|(text, forwarded)| Body::Text { text, forwarded }),
            (
                (s(), s(), any::<u64>(), s(), s()),
                proptest::option::of(s()),
                proptest::option::of(s()),
                any::<bool>(),
            )
                .prop_map(
                    |((object, mime, size, key, sha256), caption, name, forwarded)| {
                        Body::Media {
                            object,
                            mime,
                            size,
                            key,
                            sha256,
                            caption,
                            name,
                            forwarded,
                        }
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
            (s(), any::<bool>()).prop_map(|(post_id, forwarded)| Body::Post { post_id, forwarded }),
            (
                any::<i32>(),
                any::<i32>(),
                proptest::option::of(any::<u32>()),
                any::<bool>()
            )
                .prop_map(|(lat_e6, lon_e6, accuracy, forwarded)| Body::Location {
                    lat_e6,
                    lon_e6,
                    accuracy,
                    forwarded,
                }),
            proptest::option::of(s()).prop_map(|name| Body::Name { name }),
            (
                proptest::option::of(s()),
                proptest::option::of(any::<u32>())
            )
                .prop_map(|(name, timer)| Body::Settings { name, timer }),
            Just(Body::Leave {}),
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
