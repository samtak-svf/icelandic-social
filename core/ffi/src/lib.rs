//! What the apps call: the version, the envelope codec, the MLS self-test,
//! the encrypted store, and the client of decision 0018 (`client`), which
//! the app drives over its own HTTP transport and WebSocket.
//!
//! The records here mirror `spjall-envelope` so that crate stays free of FFI
//! concerns; `From` impls in both directions keep them in step, and the tests
//! round-trip every kind through them.

use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};

use spjall_envelope as envelope;

pub mod client;
pub mod frames;
pub mod social;

uniffi::setup_scaffolding!();

/// A failure, for the apps. A local failure's `detail` (`Envelope`, `Mls`,
/// `Store`, `Invalid`, `Protocol`, `File`) is a code from a fixed vocabulary
/// (0049): it names the kind of failure and never carries a value, a name, a
/// message or SQL, so it may be shown to the person. [`CoreError::code`] is
/// what they see.
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
    #[error("client is older than the minimum version {min_version}")]
    ClientTooOld {
        min_version: String,
        update_url: Option<String>,
    },
    /// The message cannot be forwarded (0041); the app offers forwarding
    /// only where it can, so this is a race with a delete or a timer.
    #[error("this message cannot be forwarded")]
    CannotForward { reason: Unforwardable },
    /// The text scanned is not a link code (0077).
    #[error("not a link code")]
    LinkCodeInvalid,
    /// The server's link request names other keys than the code shown on
    /// the screen, so it is refused unsigned (0077).
    #[error("the link request is not the one on the screen")]
    LinkKeyMismatch,
    /// The link request expired, or is not this account's.
    #[error("the link request has expired")]
    LinkExpired,
    /// The link request was approved already, by this phone or another.
    #[error("the link request is already approved")]
    LinkAlreadyApproved,
    /// A group name is 1 to 64 characters with no control characters
    /// (0078); the app checks the same before it asks.
    #[error("not a group name")]
    NameInvalid,
    /// Only a group is named or left; a conversation of two is not (0078).
    #[error("not a group")]
    NotAGroup,
    /// The image was stored before masters were kept (0086), so it cannot be
    /// framed again; the app asks the person to upload it once more.
    #[error("the image has no master to frame; upload it again")]
    NoMaster,
    /// The file is not a JPEG, PNG or WebP the core can read, so no group
    /// photo can be made of it (0094).
    #[error("not an image the core can read")]
    UnsupportedImage,
}

/// Why a message cannot be forwarded (0041).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum Unforwardable {
    /// It is under a disappearing timer.
    Disappearing,
    /// It was deleted for everyone.
    Deleted,
    /// Not a text or a file this device has: a shared post (0044), a
    /// card, or nothing.
    NotAMessage,
}

impl From<spjall_client::Unforwardable> for Unforwardable {
    fn from(reason: spjall_client::Unforwardable) -> Self {
        use spjall_client::Unforwardable as U;
        match reason {
            U::Disappearing => Self::Disappearing,
            U::Deleted => Self::Deleted,
            U::NotAMessage => Self::NotAMessage,
        }
    }
}

impl From<envelope::EnvelopeError> for CoreError {
    fn from(error: envelope::EnvelopeError) -> Self {
        match error {
            envelope::EnvelopeError::UnsupportedVersion(version) => {
                Self::UnsupportedVersion { version }
            }
            envelope::EnvelopeError::EncodeUnknown => Self::Envelope {
                detail: "encode-unknown".into(),
            },
            envelope::EnvelopeError::Malformed(_) => Self::Envelope {
                detail: "malformed".into(),
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
    /// A post shared under 0040: its id and nothing else. Sent again
    /// since 0080 (amending 0044); the receiver resolves it as a card.
    Post {
        post_id: String,
    },
    /// A place sent once (0059), in WGS 84 microdegrees, and the fix's
    /// radius in metres when the system gave one.
    Location {
        lat_e6: i32,
        lon_e6: i32,
        accuracy: Option<u32>,
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
            // The forward mark reaches the apps on `Item`, not here.
            B::Text { text, .. } => Self::Text { text },
            B::Media {
                object,
                mime,
                size,
                key,
                sha256,
                caption,
                name,
                ..
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
            // The forward mark reaches the apps on `Item`, as for text.
            B::Post { post_id, .. } => Self::Post { post_id },
            B::Location {
                lat_e6,
                lon_e6,
                accuracy,
                ..
            } => Self::Location {
                lat_e6,
                lon_e6,
                accuracy,
            },
            // Group settings and leaving reach the apps folded, through
            // `Conversation.name` and the cards (0078), never as a body.
            B::Name { .. } => Self::Unknown {
                kind: "name".into(),
            },
            B::Settings { .. } => Self::Unknown {
                kind: "settings".into(),
            },
            B::Photo { .. } => Self::Unknown {
                kind: "photo".into(),
            },
            B::Leave {} => Self::Unknown {
                kind: "leave".into(),
            },
            B::Unknown { kind } => Self::Unknown { kind },
        }
    }
}

impl From<Body> for envelope::Body {
    fn from(body: Body) -> Self {
        use Body as B;
        match body {
            // Only `forward` marks a message forwarded (0041).
            B::Text { text } => Self::Text {
                text,
                forwarded: false,
            },
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
                forwarded: false,
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
            B::Post { post_id } => Self::Post {
                post_id,
                forwarded: false,
            },
            B::Location {
                lat_e6,
                lon_e6,
                accuracy,
            } => Self::Location {
                lat_e6,
                lon_e6,
                accuracy,
                forwarded: false,
            },
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
/// What the apps need to draw a location and open it (0059).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PlaceLinks {
    /// map.is at a pin on the place; none outside Iceland and its waters,
    /// where the card opens the map app directly.
    pub map_is: Option<String>,
    /// A `geo:` URI for Android's map app.
    pub geo: String,
    /// An Apple Maps link for iOS.
    pub apple_maps: String,
    /// What copy puts on the clipboard: `64.141960, -21.926570`.
    pub copy: String,
    /// The latitude's distance from the equator, `64,14196`; `north` says
    /// which side, so the brand's sentence names it.
    pub latitude: String,
    pub north: bool,
    /// The longitude's distance from Greenwich, as `latitude`.
    pub longitude: String,
    pub east: bool,
}

/// The links and numbers for a location's place. Nothing is fetched.
#[uniffi::export]
pub fn place_links(lat_e6: i32, lon_e6: i32) -> PlaceLinks {
    let links = spjall_client::place::links(lat_e6, lon_e6);
    PlaceLinks {
        map_is: links.map_is,
        geo: links.geo,
        apple_maps: links.apple_maps,
        copy: links.copy,
        latitude: links.latitude,
        north: links.north,
        longitude: links.longitude,
        east: links.east,
    }
}

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
    spjall_mls::self_test().map_err(|_| CoreError::Mls {
        detail: "self-test".into(),
    })
}

impl From<spjall_store::rusqlite::Error> for CoreError {
    fn from(error: spjall_store::rusqlite::Error) -> Self {
        Self::Store {
            detail: store_code(&error),
        }
    }
}

/// The code of a store failure (0049): rusqlite's kind of error, with the
/// column it was reading when it names one, and for SQLite's own failure its
/// result code and extended code. Never SQLite's message, which can quote
/// SQL and the values in it.
pub(crate) fn store_code(error: &spjall_store::rusqlite::Error) -> String {
    use spjall_store::rusqlite::Error as E;
    match error {
        E::SqliteFailure(failure, _) => format!("{:?}/{}", failure.code, failure.extended_code),
        E::FromSqlConversionFailure(column, kind, _) => format!("from-sql/{column}/{kind}"),
        E::IntegralValueOutOfRange(column, _) => format!("out-of-range/{column}"),
        E::InvalidColumnType(column, name, kind) => format!("column-type/{column}/{name}/{kind}"),
        E::InvalidColumnIndex(column) => format!("column-index/{column}"),
        E::InvalidColumnName(name) => format!("column-name/{name}"),
        E::QueryReturnedNoRows => "no-rows".into(),
        E::QueryReturnedMoreThanOneRow => "more-than-one-row".into(),
        E::ExecuteReturnedResults => "execute-returned-results".into(),
        E::StatementChangedRows(rows) => format!("changed-rows/{rows}"),
        E::ToSqlConversionFailure(_) => "to-sql".into(),
        E::SqlInputError { .. } => "sql-input".into(),
        E::InvalidParameterCount(..) | E::InvalidParameterName(_) => "parameters".into(),
        _ => "other".into(),
    }
}

#[uniffi::export]
impl CoreError {
    /// What the person can quote of a failure no server answered (0049):
    /// its kind, then its code. None for the server's own answers, which
    /// carry a request id instead (0037), and for no answer at all.
    pub fn code(&self) -> Option<String> {
        Some(match self {
            Self::Unreachable { .. } | Self::Refused { .. } | Self::ClientTooOld { .. } => {
                return None;
            }
            Self::UnsupportedVersion { version } => format!("envelope/v{version}"),
            Self::Envelope { detail } => format!("envelope/{detail}"),
            Self::Mls { detail } => format!("mls/{detail}"),
            Self::Store { detail } => format!("store/{detail}"),
            Self::NotRegistered => "not-registered".into(),
            Self::UnknownConversation => "unknown-conversation".into(),
            Self::Invalid { detail } => format!("invalid/{detail}"),
            Self::Protocol { detail } => format!("protocol/{detail}"),
            Self::SignIn { .. } => "sign-in".into(),
            Self::TooLarge => "too-large".into(),
            Self::Tampered => "tampered".into(),
            Self::File { detail } => format!("file/{detail}"),
            Self::CannotForward { reason } => format!("cannot-forward/{reason:?}"),
            Self::LinkCodeInvalid => "link/invalid-code".into(),
            Self::LinkKeyMismatch => "link/key-mismatch".into(),
            Self::LinkExpired => "link/expired".into(),
            Self::LinkAlreadyApproved => "link/already-approved".into(),
            Self::NameInvalid => "group/name-invalid".into(),
            Self::NotAGroup => "group/not-a-group".into(),
            Self::NoMaster => "image/no-master".into(),
            Self::UnsupportedImage => "image/unsupported".into(),
        })
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
            detail: format!("key-length/{}", key.len()),
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
    /// A call that panicked left the store as a failed call does: its
    /// transaction rolled back as it unwound, so the lock is taken again.
    fn store(&self) -> Result<std::sync::MutexGuard<'_, spjall_store::Store>, CoreError> {
        Ok(self.store.lock().unwrap_or_else(PoisonError::into_inner))
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
            Body::Post {
                post_id: "p_1".into(),
            },
            Body::Location {
                lat_e6: 64_141_960,
                lon_e6: -21_926_570,
                accuracy: Some(12),
            },
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

    /// An unreadable item carries the code the same failure has as an
    /// error (0051), so the apps show one vocabulary.
    #[test]
    fn an_envelope_failure_has_one_code_as_error_and_as_item() {
        for error in [
            envelope::EnvelopeError::UnsupportedVersion(99),
            envelope::EnvelopeError::EncodeUnknown,
            envelope::EnvelopeError::Malformed("marker-4711".into()),
        ] {
            let item = error.code();
            assert!(!item.contains("marker"));
            assert_eq!(CoreError::from(error).code(), Some(item));
        }
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
        assert_eq!(store.schema_version().unwrap(), 18);
        drop(store);
        assert!(matches!(
            CoreStore::open(path.clone(), vec![2; 32]),
            Err(CoreError::Store { .. })
        ));
        assert!(matches!(
            CoreStore::open(path, vec![1; 31]),
            Err(CoreError::Store { detail }) if detail == "key-length/31"
        ));
    }

    #[test]
    fn a_store_code_names_the_failure_and_not_the_values() {
        use spjall_store::rusqlite::Connection;
        let db = Connection::open_in_memory().unwrap();
        db.execute_batch("CREATE TABLE t (x TEXT UNIQUE)").unwrap();
        let insert = "INSERT INTO t (x) VALUES ('marker-4711')";
        db.execute(insert, []).unwrap();
        let failure = db.execute(insert, []).unwrap_err();
        assert!(failure.to_string().contains("t.x"));
        let error = CoreError::from(failure);
        assert_eq!(error.code().unwrap(), "store/ConstraintViolation/2067");
        assert!(!format!("{error:?}").contains("t.x"));
        let error = CoreError::from(
            db.query_row("SELECT x FROM t", [], |row| row.get::<_, i64>(0))
                .unwrap_err(),
        );
        assert_eq!(error.code().unwrap(), "store/column-type/0/x/Text");
        let error = CoreError::from(
            db.query_row("SELECT x FROM t WHERE x = 'none'", [], |_| Ok(()))
                .unwrap_err(),
        );
        assert_eq!(error.code().unwrap(), "store/no-rows");
    }

    #[test]
    fn a_client_failure_keeps_its_static_reason_and_drops_free_text() {
        use spjall_client::ClientError;
        use spjall_mls::group::GroupError;
        let code = |error: ClientError| CoreError::from(error).code().unwrap();
        assert_eq!(
            code(ClientError::Protocol("a stored media row")),
            "protocol/a stored media row"
        );
        assert_eq!(
            code(ClientError::Invalid("account id")),
            "invalid/account id"
        );
        assert_eq!(code(ClientError::NotRegistered), "not-registered");
        let openmls = code(ClientError::Mls(GroupError::Mls {
            step: "merge",
            detail: "marker-4711".into(),
        }));
        assert_eq!(openmls, "mls/openmls/merge");
        assert_eq!(
            code(ClientError::Mls(GroupError::Malformed("group id"))),
            "mls/malformed/group id"
        );
        let malformed = envelope_decode(b"{\"v\":1,\"marker-4711\"".to_vec()).unwrap_err();
        assert_eq!(malformed.code().unwrap(), "envelope/malformed");
    }

    #[test]
    fn a_server_answer_has_no_code() {
        let refused = CoreError::Refused {
            status: 403,
            code: "forbidden".into(),
            request_id: Some("r1".into()),
        };
        assert_eq!(refused.code(), None);
        let unreachable = CoreError::Unreachable {
            detail: "offline".into(),
        };
        assert_eq!(unreachable.code(), None);
        let too_old = CoreError::ClientTooOld {
            min_version: "0.5.0".into(),
            update_url: None,
        };
        assert_eq!(too_old.code(), None);
    }

    #[test]
    fn version_is_the_workspace_version() {
        assert_eq!(core_version(), env!("CARGO_PKG_VERSION"));
    }
}
