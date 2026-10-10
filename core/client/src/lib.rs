//! The client engine of decision 0018: this device's identity, its
//! conversations, the outbox and sync, over the store of 0016 and the groups
//! of `spjall_mls::group`. The app moves bytes: it makes HTTP requests for
//! the `Transport` and hands each WebSocket frame to `Client::on_frame`.
//!
//! Every outgoing item is sealed once into an outbox row, in the transaction
//! that advances the ratchet, and those bytes are sent until the server
//! answers. A commit stays pending until the fetch that reaches its seq
//! merges it, and nothing is sealed past it. Each received message is
//! decrypted and stored in one transaction, which also moves the cursor.
//!
//! The server keeps the roster each commit claims (0020). A commit whose
//! claim MLS does not back queues a correcting commit, and a refusal no
//! commit explains leaves the conversation `Excluded` until one restores it.
//!
//! Every commit carries the GroupInfo of its epoch (0021). A device no
//! Welcome names, or one gone `Stale`, joins from the latest by an external
//! commit, sent before anything else in that conversation.

mod account;
pub mod api;
mod block;
mod directory;
mod feed;
mod forward;
mod media;
mod members;
mod mute;
mod notice;
mod read;
mod timeline;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub use account::{Linked, SignedIn, invite_token};
use api::{Api, ApiError, Outgoing, Platform, Profile, Transport, conversation_id, group_id};
pub use directory::{Directory, MAX_QUERY, fold_name};
pub use feed::MAX_POST;
pub use media::{MAX_SIZE, MediaError};
pub use members::Person;
pub use mute::{Mute, MuteFor};
pub use notice::{Notice, NoticeKind, Notices};
pub use read::Settings;
use serde::Deserialize;
use spjall_envelope::{Body, Envelope, EnvelopeError};
use spjall_mls::group::{
    Claimed, Device, Group, GroupError, Identity, Received, generate_device_key, is_commit,
};
use spjall_mls::storage::Provider;
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};
use spjall_store::{Key, Store};
pub use timeline::{Content, Item, Quote, Reaction, Status, Unforwardable};

use members::{refresh_members, set_members};
use timeline::{fold, fold_members};

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("the store failed: {0}")]
    Store(#[from] rusqlite::Error),
    #[error(transparent)]
    Mls(#[from] GroupError),
    #[error(transparent)]
    Transport(#[from] ApiError),
    #[error(transparent)]
    Envelope(#[from] EnvelopeError),
    /// No device key yet, or the server has not registered it.
    #[error("this device is not registered")]
    NotRegistered,
    /// A sign-in could not go on: none is pending, the callback is not the
    /// one it waits for, or Kenni answered with an error.
    #[error("sign-in: {0}")]
    SignIn(String),
    #[error("no such conversation, or not one this device is in")]
    UnknownConversation,
    /// The app asked for something this client does not do.
    #[error("invalid: {0}")]
    Invalid(&'static str),
    /// The server answered outside the contract.
    #[error("the server broke the contract: {0}")]
    Protocol(&'static str),
    #[error(transparent)]
    Media(#[from] MediaError),
    /// The message cannot be forwarded (0041).
    #[error("this message cannot be forwarded: {0:?}")]
    CannotForward(Unforwardable),
}

/// Where a conversation stands for this device.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum State {
    /// Made here; the server does not have it yet.
    New,
    Active,
    /// The server refuses this device, but no commit it has read removed
    /// it: another member's claim left it out. It is tried again on the
    /// next notify, which the commit that restores it sends (0020).
    Excluded,
    /// A commit removed this account.
    Removed,
    /// This device missed what it needed to follow the group: messages
    /// expired before it fetched them, or a commit it could not process. It
    /// joins again by an external commit on the next `sync` or notify, and
    /// keeps its history (0021). A conversation this device is joining for
    /// the first time is `Stale` until the server has its commit.
    Stale,
}

impl State {
    fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Active => "active",
            Self::Excluded => "excluded",
            Self::Removed => "removed",
            Self::Stale => "stale",
        }
    }

    fn parse(text: &str) -> rusqlite::Result<Self> {
        Ok(match text {
            "new" => Self::New,
            "active" => Self::Active,
            "excluded" => Self::Excluded,
            "removed" => Self::Removed,
            "stale" => Self::Stale,
            _ => return Err(rusqlite::Error::InvalidQuery),
        })
    }
}

/// A conversation as the list shows it (0022).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conversation {
    pub id: String,
    pub state: State,
    /// Everyone here but this account, named ones first.
    pub members: Vec<Person>,
    /// The newest item, if any.
    pub last: Option<Item>,
    pub unread: u32,
    /// The disappearing timer, in seconds.
    pub timer: Option<u32>,
    /// Whether this account muted it (0042). `unread` still counts.
    pub mute: Mute,
}

/// A message in history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub conversation: String,
    pub seq: u64,
    pub sender: Device,
    pub envelope: Envelope,
    /// Sent by this device.
    pub own: bool,
}

/// What changed, for the app to show.
#[derive(Debug, Clone, PartialEq, Eq)]
#[expect(
    clippy::large_enum_variant,
    reason = "an event lives for one sync round; boxing the message would only move the bytes"
)]
pub enum Event {
    Message(Message),
    Membership {
        conversation: String,
        added: Vec<String>,
        removed: Vec<String>,
    },
    /// This device joined, or joined again after it was `Stale`.
    Joined {
        conversation: String,
    },
    /// New devices of accounts already in the conversation, from a Welcome
    /// or an external commit: the "new device" of 0006.
    Devices {
        conversation: String,
        joined: Vec<Device>,
    },
    Removed {
        conversation: String,
    },
    Stale {
        conversation: String,
    },
    Typing {
        conversation: String,
        active: bool,
    },
    /// Timeline items changed, by seq. Empty when only read state or the
    /// mute moved.
    Timeline {
        conversation: String,
        changed: Vec<u64>,
    },
    /// The core fetched these accounts' names and marks.
    Profiles {
        accounts: Vec<String>,
    },
    /// Items whose disappearing timer ran out, by seq; they and their
    /// files are gone from this device.
    Expired {
        conversation: String,
        removed: Vec<u64>,
    },
}

/// What a call produced: events to show and frames to send on the socket.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Outcome {
    pub events: Vec<Event>,
    pub frames: Vec<String>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum Incoming {
    Hello {},
    Notify {
        #[serde(rename = "conversationId")]
        conversation: String,
        seq: u64,
    },
    Typing {
        #[serde(rename = "conversationId")]
        conversation: String,
        ciphertext: String,
    },
    Ping {
        nonce: Option<String>,
    },
    /// This account's mute changed on one of its devices (0042).
    Mute {
        #[serde(rename = "conversationId")]
        conversation: String,
        muted: bool,
        until: Option<u64>,
    },
    #[serde(other)]
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Message,
    Add,
    Remove,
    /// A commit that changes no one and claims the roster MLS holds.
    Correct,
    /// An external commit, sealed when it is made (0021).
    Join,
    /// A commit removing leaves the server no longer serves (0028).
    RemoveDevices,
}

impl Kind {
    fn parse(text: &str) -> rusqlite::Result<Self> {
        Ok(match text {
            "message" => Self::Message,
            "add" => Self::Add,
            "remove" => Self::Remove,
            "correct" => Self::Correct,
            "join" => Self::Join,
            "remove_devices" => Self::RemoveDevices,
            _ => return Err(rusqlite::Error::InvalidQuery),
        })
    }
}

/// An outbox row not yet answered with a seq.
struct Unsent {
    id: i64,
    kind: Kind,
    intent: Vec<u8>,
    sealed: Option<Outgoing>,
}

enum Sealed {
    Ready(Outgoing),
    /// An own commit is pending: the fetch that merges it comes first.
    Blocked,
    /// Nothing to send from this row now: it is gone, or another
    /// process sealed it; the drain reads the outbox again.
    Dropped,
}

#[derive(PartialEq, Eq)]
enum Drain {
    Done,
    Blocked,
    Over,
}

/// How many times a join is made again in one call after another commit
/// took its epoch.
const JOIN_ATTEMPTS: usize = 3;

/// At most one typing frame per conversation this often (0022).
const TYPING_EVERY: Duration = Duration::from_secs(3);

/// How often each conversation's devices are checked against the server's
/// (0028), in milliseconds.
const DEVICES_CHECK_EVERY: i64 = 60 * 60 * 1000;

/// How often `sync` counts this device's KeyPackages (0029), in milliseconds.
const STOCK_EVERY: i64 = 24 * 60 * 60 * 1000;

/// How many unclaimed KeyPackages `sync` keeps on the server.
const KEY_PACKAGE_TARGET: u32 = 10;

/// A last resort that expires sooner than this is replaced (0029), in
/// milliseconds: the server stops counting a package this close to expiry.
const LAST_RESORT_RENEW: u64 = 14 * 24 * 60 * 60 * 1000;

/// Only `ClientTooOld` of what failed: a step the next sync tries again
/// cannot be, for a build the server no longer serves (0030).
fn too_old<T>(result: Result<T, ClientError>) -> Result<(), ClientError> {
    match result {
        Err(error @ ClientError::Transport(ApiError::ClientTooOld { .. })) => Err(error),
        _ => Ok(()),
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

/// 16 random bytes in hex: a `clientMsgId`, and an envelope's id.
fn random_id() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the OS has randomness");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_id(text: &str) -> bool {
    (1..=128).contains(&text.len())
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// Account ids one per line, as the outbox keeps them; `None` for none.
fn lines(accounts: &[String]) -> Option<String> {
    (!accounts.is_empty()).then(|| accounts.join("\n"))
}

fn split(lines: Option<String>) -> Vec<String> {
    lines
        .map(|l| l.split('\n').map(str::to_owned).collect())
        .unwrap_or_default()
}

fn accounts(devices: Vec<Device>) -> Vec<String> {
    let mut accounts: Vec<String> = devices.into_iter().map(|d| d.account).collect();
    accounts.sort();
    accounts.dedup();
    accounts
}

fn this_device(tx: &Transaction) -> Result<(Vec<u8>, Device), ClientError> {
    let row: Option<(Vec<u8>, Option<String>, Option<String>)> = tx
        .query_row(
            "SELECT device_key, account_id, device_id FROM account",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    match row {
        Some((key, Some(account), Some(device))) => Ok((key, Device::new(&account, &device)?)),
        _ => Err(ClientError::NotRegistered),
    }
}

fn identity(tx: &Transaction, provider: &Provider) -> Result<Identity, ClientError> {
    let (key, device) = this_device(tx)?;
    Ok(Identity::load(provider, &key, device)?)
}

fn conversation_of(tx: &Transaction, group: &[u8]) -> Result<Option<(State, u64)>, ClientError> {
    Ok(tx
        .query_row(
            &format!("SELECT {STATE}, cursor FROM conversations WHERE group_id = ?1"),
            [group],
            |r| {
                Ok((
                    State::parse(&r.get::<_, String>(0)?)?,
                    r.get::<_, i64>(1)? as u64,
                ))
            },
        )
        .optional()?)
}

/// A conversation's `State` as stored: `excluded` only ever qualifies `active`.
const STATE: &str = "CASE excluded WHEN 1 THEN 'excluded' ELSE state END";

fn conversation_state(tx: &Transaction, group: &[u8]) -> Result<State, ClientError> {
    conversation_of(tx, group)?
        .map(|c| c.0)
        .ok_or(ClientError::UnknownConversation)
}

/// A conversation this device can still send to.
fn open_conversation(tx: &Transaction, group: &[u8]) -> Result<(), ClientError> {
    match conversation_state(tx, group)? {
        State::New | State::Active | State::Excluded => Ok(()),
        State::Removed | State::Stale => Err(ClientError::UnknownConversation),
    }
}

fn enqueue(tx: &Transaction, group: &[u8], kind: &str, intent: &[u8]) -> Result<(), ClientError> {
    tx.execute(
        "INSERT INTO outbox (group_id, kind, intent, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![group, kind, intent, now()],
    )?;
    Ok(())
}

/// Whether a message wakes the other members' devices (0025): a new text,
/// reply or file does; a receipt, reaction, edit, delete or timer does not.
fn urgent(intent: &[u8]) -> bool {
    Envelope::decode(intent).is_ok_and(|e| {
        matches!(
            e.body,
            Body::Text { .. } | Body::Reply { .. } | Body::Media { .. }
        )
    })
}

/// The first row of this conversation the server has not answered: a
/// sealed one, which is sent as the same bytes until it is, then a removal
/// of leaves the server no longer serves (0028), then the rest in order.
fn next_unsent(tx: &Transaction, group: &[u8]) -> Result<Option<Unsent>, ClientError> {
    type Row = (
        i64,
        String,
        Vec<u8>,
        Option<String>,
        Option<Vec<u8>>,
        Option<Vec<u8>>,
        Option<Vec<u8>>,
    );
    let row: Option<Row> = tx
        .query_row(
            "SELECT id, kind, intent, client_msg_id, ciphertext, welcome, group_info
             FROM outbox WHERE group_id = ?1 AND seq IS NULL AND kind != 'join'
             ORDER BY ciphertext IS NULL, kind = 'remove_devices' DESC, id LIMIT 1",
            [group],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                ))
            },
        )
        .optional()?;
    let Some((id, kind, intent, client_msg_id, ciphertext, welcome, group_info)) = row else {
        return Ok(None);
    };
    let urgent = kind == "message" && urgent(&intent);
    let sealed = client_msg_id
        .zip(ciphertext)
        .map(|(client_msg_id, ciphertext)| Outgoing {
            client_msg_id,
            ciphertext,
            welcome,
            group_info,
            urgent,
        });
    Ok(Some(Unsent {
        id,
        kind: Kind::parse(&kind)?,
        intent,
        sealed,
    }))
}

fn set_state(tx: &Transaction, group: &[u8], state: State) -> rusqlite::Result<()> {
    let (stored, excluded) = match state {
        State::Excluded => (State::Active, true),
        other => (other, false),
    };
    tx.execute(
        "UPDATE conversations SET state = ?2, excluded = ?3 WHERE group_id = ?1",
        params![group, stored.as_str(), excluded],
    )
    .map(drop)
}

/// Forgets a sealed row that the server refused, and the commit it holds,
/// keeping its intent to seal again later.
fn unseal(tx: &Transaction, group: &[u8], id: i64) -> Result<(), ClientError> {
    let provider = Provider::new(tx);
    let mut mls = Group::load(&provider, group)?;
    if mls.has_pending_commit() {
        mls.clear_pending_commit(&provider)?;
    }
    tx.execute(
        "UPDATE outbox SET client_msg_id = NULL, ciphertext = NULL,
             roster_add = NULL, roster_remove = NULL, welcome = NULL, group_info = NULL
         WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// A correcting commit is queued once, and only until a commit with a
/// backed claim, which sets the server's roster right on its own.
fn queue_correction(tx: &Transaction, group: &[u8]) -> Result<(), ClientError> {
    if !correction_queued(tx, group)? {
        enqueue(tx, group, "correct", &[])?;
    }
    Ok(())
}

fn correction_queued(tx: &Transaction, group: &[u8]) -> rusqlite::Result<bool> {
    tx.query_row(
        "SELECT EXISTS (SELECT 1 FROM outbox
                        WHERE group_id = ?1 AND kind = 'correct' AND ciphertext IS NULL)",
        [group],
        |r| r.get(0),
    )
}

fn drop_correction(tx: &Transaction, group: &[u8]) -> rusqlite::Result<()> {
    tx.execute(
        "DELETE FROM outbox WHERE group_id = ?1 AND kind = 'correct' AND ciphertext IS NULL",
        [group],
    )
    .map(drop)
}

/// A join this device sealed and the server has not answered.
fn pending_join(tx: &Transaction, group: &[u8]) -> Result<Option<(i64, Outgoing)>, ClientError> {
    Ok(tx
        .query_row(
            "SELECT id, client_msg_id, ciphertext, group_info FROM outbox
             WHERE group_id = ?1 AND kind = 'join'",
            [group],
            |r| {
                Ok((
                    r.get(0)?,
                    Outgoing {
                        client_msg_id: r.get(1)?,
                        ciphertext: r.get(2)?,
                        welcome: None,
                        group_info: r.get(3)?,
                        urgent: false,
                    },
                ))
            },
        )
        .optional()?)
}

/// Builds the group from a GroupInfo by an external commit and seals that
/// commit. A group this device held before is forgotten first; its history
/// is kept.
fn seal_join(
    tx: &Transaction,
    group: &[u8],
    group_info: &[u8],
) -> Result<(i64, Outgoing), ClientError> {
    let provider = Provider::new(tx);
    let identity = identity(tx, &provider)?;
    match Group::load(&provider, group) {
        Ok(old) => old.delete(&provider)?,
        Err(GroupError::Missing(_)) => {}
        Err(error) => return Err(error.into()),
    }
    let (mls, commit) = Group::join_external(&provider, &identity, group_info)?;
    if mls.id() != group {
        return Err(ClientError::Protocol("a GroupInfo for another group"));
    }
    tx.execute(
        "INSERT INTO conversations (group_id, state, cursor, created_at)
         VALUES (?1, 'stale', 0, ?2) ON CONFLICT (group_id) DO NOTHING",
        params![group, now()],
    )?;
    refresh_members(tx, group, &mls)?;
    let out = Outgoing {
        client_msg_id: random_id(),
        ciphertext: commit.message,
        welcome: None,
        group_info: Some(commit.group_info),
        urgent: false,
    };
    tx.execute(
        "INSERT INTO outbox (group_id, kind, intent, client_msg_id, ciphertext, group_info,
                             created_at)
         VALUES (?1, 'join', x'', ?2, ?3, ?4, ?5)",
        params![
            group,
            out.client_msg_id,
            out.ciphertext,
            out.group_info,
            now()
        ],
    )?;
    Ok((tx.last_insert_rowid(), out))
}

/// The server refused a join: forget it and the group it built. A
/// conversation this device never read is forgotten with it.
fn drop_join(tx: &Transaction, group: &[u8], id: i64) -> Result<(), ClientError> {
    tx.execute("DELETE FROM outbox WHERE id = ?1", [id])?;
    let provider = Provider::new(tx);
    match Group::load(&provider, group) {
        Ok(mls) => mls.delete(&provider)?,
        Err(GroupError::Missing(_)) => {}
        Err(error) => return Err(error.into()),
    }
    tx.execute(
        "DELETE FROM conversations WHERE group_id = ?1 AND cursor = 0",
        [group],
    )?;
    Ok(())
}

fn store_message(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    sender: &Device,
    envelope: &[u8],
    hidden: bool,
) -> rusqlite::Result<()> {
    let timer: Option<i64> = tx.query_row(
        "SELECT timer FROM conversations WHERE group_id = ?1",
        [group],
        |r| r.get(0),
    )?;
    let stored_at = now();
    tx.execute(
        "INSERT INTO messages (group_id, seq, sender_account, sender_device, envelope, stored_at,
                               expires_at, hidden)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            group,
            seq as i64,
            sender.account,
            sender.device,
            envelope,
            stored_at,
            timer.map(|t| stored_at + t * 1000),
            hidden
        ],
    )
    .map(drop)
}

/// The API as this device, which needs its token.
fn authed<'a, T: Transport>(
    transport: &'a T,
    token: &'a Option<String>,
    client: &'a Option<String>,
) -> Result<Api<'a, T>, ClientError> {
    let token = token.as_deref().ok_or(ClientError::NotRegistered)?;
    Ok(Api::new(transport, Some(token)).client(client.as_deref()))
}

/// `major.minor.patch`, each at most six digits, as the server reads it.
fn is_version(text: &str) -> bool {
    let parts: Vec<&str> = text.split('.').collect();
    parts.len() == 3
        && parts
            .iter()
            .all(|p| (1..=6).contains(&p.len()) && p.bytes().all(|b| b.is_ascii_digit()))
}

fn ack(conversation: &str, seq: u64) -> String {
    serde_json::json!({ "type": "ack", "conversationId": conversation, "seq": seq }).to_string()
}

pub struct Client<T> {
    store: Store,
    transport: T,
    /// The device token, from the store; `None` until sign-in.
    token: Option<String>,
    /// What happened since the last call returned; kept when a call fails
    /// half way, so the next one still reports it.
    outcome: Outcome,
    /// When each conversation's last `active` typing frame was made.
    typed: HashMap<Vec<u8>, Instant>,
    /// The store's folder for decrypted and sent files.
    media: PathBuf,
    /// This build as `Spjall-Client` names it (0030); none until the app
    /// sets it, which the server reads as the oldest build.
    client: Option<String>,
}

impl<T: Transport> Client<T> {
    pub fn open(dir: &Path, key: &Key, transport: T) -> Result<Self, ClientError> {
        let mut store = Store::open(dir, key)?;
        let media = store
            .path()
            .parent()
            .expect("the store is a file in a folder")
            .join("media");
        let token = store.write(|tx| {
            Ok(tx
                .query_row("SELECT device_token FROM account", [], |r| r.get(0))
                .optional()?
                .flatten())
        })?;
        Ok(Self {
            store,
            transport,
            token,
            outcome: Outcome::default(),
            typed: HashMap::new(),
            media,
            client: None,
        })
    }

    /// Names this build on every request from now on, so the server can
    /// tell a build below its floor to update (0030).
    pub fn set_client_version(
        &mut self,
        platform: Platform,
        version: &str,
    ) -> Result<(), ClientError> {
        if !is_version(version) {
            return Err(ClientError::Invalid("client version"));
        }
        let platform = match platform {
            Platform::Android => "android",
            Platform::Ios => "ios",
        };
        self.client = Some(format!("{platform}/{version}"));
        Ok(())
    }

    /// The `Spjall-Client` value, for the app to set on the WebSocket
    /// upgrade, which it makes itself.
    pub fn client_header(&self) -> Option<&str> {
        self.client.as_deref()
    }

    /// This device's public key, made on first use. It is what
    /// `POST /v1/devices` registers.
    pub fn device_key(&mut self) -> Result<Vec<u8>, ClientError> {
        self.store.try_write(|tx| {
            let key: Option<Vec<u8>> = tx
                .query_row("SELECT device_key FROM account", [], |r| r.get(0))
                .optional()?;
            if let Some(key) = key {
                return Ok(key);
            }
            let key = generate_device_key(&Provider::new(tx))?;
            tx.execute(
                "INSERT INTO account (id, device_key) VALUES (1, ?1)",
                [&key],
            )?;
            Ok(key)
        })
    }

    /// Tops this device's unclaimed KeyPackages up to `target`, at most 100
    /// at a time, with a fresh last-resort package whenever it uploads, and
    /// replaces a last resort near its expiry (0029). Returns how many the
    /// server holds.
    pub fn stock_key_packages(&mut self, target: u32) -> Result<u32, ClientError> {
        let api = authed(&self.transport, &self.token, &self.client)?;
        let stock = api.upload_key_packages(&[], None)?;
        let renew = stock
            .last_resort_not_after
            .is_none_or(|at| at < now() as u64 + LAST_RESORT_RENEW);
        let stocked = |client: &mut Self| {
            client.store.try_write(|tx| {
                tx.execute("UPDATE account SET key_packages_stocked_at = ?1", [now()])
                    .map(drop)
            })
        };
        if stock.available >= target && !renew {
            stocked(self)?;
            return Ok(stock.available);
        }
        let n = target.saturating_sub(stock.available).min(100) as usize;
        let (packages, last_resort) = self.store.try_write(|tx| {
            let provider = Provider::new(tx);
            let identity = identity(tx, &provider)?;
            Ok::<_, ClientError>((
                identity.key_packages(&provider, n)?,
                identity.last_resort(&provider)?,
            ))
        })?;
        let stock = api.upload_key_packages(&packages, Some(&last_resort))?;
        stocked(self)?;
        Ok(stock.available)
    }

    /// Counts this device's KeyPackages if a day has passed since (0029).
    fn restock(&mut self) -> Result<(), ClientError> {
        let due = self.store.try_write(|tx| {
            let at: Option<Option<i64>> = tx
                .query_row("SELECT key_packages_stocked_at FROM account", [], |r| {
                    r.get(0)
                })
                .optional()?;
            Ok::<_, ClientError>(at.flatten().is_none_or(|at| at + STOCK_EVERY <= now()))
        })?;
        if due {
            self.stock_key_packages(KEY_PACKAGE_TARGET)?;
        }
        Ok(())
    }

    /// A new conversation with these accounts and this account's other
    /// devices. It reaches the server on the next `sync`.
    pub fn create_conversation(&mut self, with: &[String]) -> Result<String, ClientError> {
        if !with.iter().all(|a| is_id(a)) {
            return Err(ClientError::Invalid("account id"));
        }
        let group = self.store.try_write(|tx| {
            let provider = Provider::new(tx);
            let identity = identity(tx, &provider)?;
            let group = Group::create(&provider, &identity)?;
            let mut intent = with.to_vec();
            intent.push(identity.device().account.clone());
            tx.execute(
                "INSERT INTO conversations (group_id, state, cursor, created_at)
                 VALUES (?1, 'new', 0, ?2)",
                params![group.id(), now()],
            )?;
            // Who it is meant for, until the commit that adds them is back.
            set_members(tx, group.id(), &intent)?;
            enqueue(
                tx,
                group.id(),
                "add",
                lines(&intent).unwrap_or_default().as_bytes(),
            )?;
            Ok::<_, ClientError>(group.id().to_vec())
        })?;
        Ok(conversation_id(&group))
    }

    /// Adds every device of these accounts, on the next `sync`.
    pub fn add_accounts(
        &mut self,
        conversation: &str,
        accounts: &[String],
    ) -> Result<(), ClientError> {
        self.change(conversation, accounts, "add")
    }

    /// Removes every device of these accounts, on the next `sync`.
    pub fn remove_accounts(
        &mut self,
        conversation: &str,
        accounts: &[String],
    ) -> Result<(), ClientError> {
        self.change(conversation, accounts, "remove")
    }

    fn change(
        &mut self,
        conversation: &str,
        accounts: &[String],
        kind: &str,
    ) -> Result<(), ClientError> {
        if accounts.is_empty() || !accounts.iter().all(|a| is_id(a)) {
            return Err(ClientError::Invalid("account id"));
        }
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.store.try_write(|tx| {
            if kind == "remove" && accounts.contains(&this_device(tx)?.1.account) {
                return Err(ClientError::Mls(GroupError::OwnAccount));
            }
            open_conversation(tx, &group)?;
            enqueue(
                tx,
                &group,
                kind,
                lines(accounts).unwrap_or_default().as_bytes(),
            )
        })
    }

    /// Queues an envelope with this body; it is sealed and sent by `sync`.
    /// Returns the envelope's id, which is also its `clientMsgId`.
    pub fn send(&mut self, conversation: &str, body: Body) -> Result<String, ClientError> {
        if matches!(body, Body::Typing { .. }) {
            return Err(ClientError::Invalid(
                "typing goes by typing(), never stored",
            ));
        }
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        let envelope = Envelope {
            id: random_id(),
            ts: now() as u64,
            body,
        };
        let bytes = envelope.encode()?;
        self.store.try_write(|tx| {
            open_conversation(tx, &group)?;
            enqueue(tx, &group, "message", &bytes)
        })?;
        Ok(envelope.id)
    }

    /// A typing frame for the socket, sealed on the current epoch. None
    /// when typing is turned off, or when an `active` one was made here
    /// less than 3 s ago.
    pub fn typing(
        &mut self,
        conversation: &str,
        active: bool,
    ) -> Result<Option<String>, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        if active
            && self
                .typed
                .get(&group)
                .is_some_and(|t| t.elapsed() < TYPING_EVERY)
        {
            return Ok(None);
        }
        let envelope = Envelope {
            id: random_id(),
            ts: now() as u64,
            body: Body::Typing { active },
        }
        .encode()?;
        let sealed = self.store.try_write(|tx| {
            if conversation_state(tx, &group)? != State::Active {
                return Err(ClientError::UnknownConversation);
            }
            if !read::settings(tx)?.typing {
                return Ok(None);
            }
            let provider = Provider::new(tx);
            Ok(Some(
                Group::load(&provider, &group)?.seal_typing(&provider, &envelope)?,
            ))
        })?;
        let Some(sealed) = sealed else {
            return Ok(None);
        };
        if active {
            self.typed.insert(group, Instant::now());
        } else {
            self.typed.remove(&group);
        }
        Ok(Some(
            serde_json::json!({
                "type": "typing",
                "conversationId": conversation,
                "ciphertext": api::base64(&sealed),
            })
            .to_string(),
        ))
    }

    /// Every conversation, the one with the newest activity first.
    pub fn conversations(&mut self) -> Result<Vec<Conversation>, ClientError> {
        self.purge()?;
        self.store.try_write(|tx| {
            let mut statement = tx.prepare(&format!(
                "SELECT group_id, {STATE}, timer FROM conversations c
                 ORDER BY MAX(created_at,
                              COALESCE((SELECT MAX(stored_at) FROM timeline t
                                        WHERE t.group_id = c.group_id), 0),
                              COALESCE((SELECT MAX(created_at) FROM outbox o
                                        WHERE o.group_id = c.group_id AND o.kind = 'message'),
                                       0)) DESC,
                          created_at DESC"
            ))?;
            let rows: Vec<(Vec<u8>, State, Option<u32>)> = statement
                .query_map([], |r| {
                    Ok((r.get(0)?, State::parse(&r.get::<_, String>(1)?)?, r.get(2)?))
                })?
                .collect::<rusqlite::Result<_>>()?;
            if rows.is_empty() {
                // Signed out, or none yet.
                return Ok(Vec::new());
            }
            let (_, me) = this_device(tx)?;
            let mut conversations = Vec::with_capacity(rows.len());
            for (group, state, timer) in rows {
                conversations.push(Conversation {
                    id: conversation_id(&group),
                    state,
                    members: notice::others(tx, &group, &me.account)?,
                    last: timeline::items(tx, &group, &me.account, None, 1)?.pop(),
                    unread: read::unread(tx, &group, &me.account)?,
                    timer,
                    mute: mute::mute_of(tx, &group)?,
                });
            }
            Ok(conversations)
        })
    }

    /// Up to `limit` items before the item `before` (or the newest), oldest
    /// first; the newest page ends with what is still being sent (0022).
    pub fn timeline(
        &mut self,
        conversation: &str,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<Item>, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.purge()?;
        self.store.try_write(|tx| {
            conversation_state(tx, &group)?;
            let (_, me) = this_device(tx)?;
            timeline::items(tx, &group, &me.account, before, limit)
        })
    }

    /// Everything up to the item `seq` is on screen. With read markers on,
    /// a receipt is queued when that moved this account's mark; the next
    /// `sync` sends it.
    pub fn mark_read(&mut self, conversation: &str, seq: u64) -> Result<(), ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.store.try_write(|tx| {
            let state = conversation_state(tx, &group)?;
            let (_, me) = this_device(tx)?;
            if read::advance(tx, &group, &me.account, seq)?.is_none()
                || !read::settings(tx)?.read_markers
                || !matches!(state, State::Active | State::Excluded)
            {
                return Ok(());
            }
            let Some(up_to) = timeline::receipt_target(tx, &group, seq)? else {
                return Ok(());
            };
            let envelope = Envelope {
                id: random_id(),
                ts: now() as u64,
                body: Body::Receipt { up_to },
            };
            enqueue(tx, &group, "message", &envelope.encode()?)
        })
    }

    /// Sends a conversation's failed items again.
    pub fn retry(&mut self, conversation: &str) -> Result<Outcome, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.store.try_write(|tx| {
            conversation_state(tx, &group)?;
            Ok::<_, ClientError>(
                tx.execute("UPDATE outbox SET failed = 0 WHERE group_id = ?1", [&group])?,
            )
        })?;
        self.sync_one(&group)?;
        Ok(std::mem::take(&mut self.outcome))
    }

    /// The accounts met through shared conversations: whom a new
    /// conversation can be started with.
    pub fn people(&mut self) -> Result<Vec<Person>, ClientError> {
        self.store.try_write(|tx| {
            let (_, me) = this_device(tx)?;
            Ok(members::people(tx, &me.account)?)
        })
    }

    /// One account's name and mark, fetched now when the server will give
    /// them, else as last fetched.
    pub fn profile(&mut self, account: &str) -> Result<Person, ClientError> {
        if !is_id(account) {
            return Err(ClientError::Invalid("account id"));
        }
        let fetched = match authed(&self.transport, &self.token, &self.client)?.profile(account) {
            Ok(profile) => Some(Some(profile)),
            Err(ApiError::Refused { status: 404, .. }) => Some(None),
            Err(ApiError::Unreachable(_)) => None,
            Err(error) => return Err(error.into()),
        };
        self.store.try_write(|tx| {
            if let Some(profile) = &fetched {
                members::store_profile(tx, account, profile.as_ref())?;
            }
            Ok(members::person(tx, account)?)
        })
    }

    pub fn settings(&mut self) -> Result<Settings, ClientError> {
        Ok(self.store.try_write(read::settings)?)
    }

    pub fn set_settings(&mut self, settings: Settings) -> Result<(), ClientError> {
        Ok(self
            .store
            .try_write(|tx| read::set_settings(tx, settings))?)
    }

    /// Up to `limit` messages before `before` (or the newest), oldest first.
    pub fn history(
        &mut self,
        conversation: &str,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<Message>, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
        self.store.try_write(|tx| {
            let (_, me) = this_device(tx)?;
            let mut statement = tx.prepare(
                "SELECT seq, sender_account, sender_device, envelope FROM messages
                 WHERE group_id = ?1 AND seq < ?2 AND hidden = 0 ORDER BY seq DESC LIMIT ?3",
            )?;
            let rows = statement.query_map(
                params![group, before.map_or(i64::MAX, |b| b as i64), limit],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)? as u64,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Vec<u8>>(3)?,
                    ))
                },
            )?;
            let mut messages = Vec::new();
            for row in rows {
                let (seq, account, device, envelope) = row?;
                let sender = Device::new(&account, &device)?;
                messages.push(Message {
                    conversation: conversation.to_owned(),
                    seq,
                    own: sender == me,
                    sender,
                    envelope: Envelope::decode(&envelope)?,
                });
            }
            messages.reverse();
            Ok(messages)
        })
    }

    /// Sends what the outbox holds and fetches what came, for every
    /// conversation this device is in.
    pub fn sync(&mut self) -> Result<Outcome, ClientError> {
        let groups: Vec<Vec<u8>> = self.store.try_write(|tx| {
            let mut statement = tx.prepare(
                "SELECT group_id FROM conversations WHERE state IN ('new', 'active', 'stale')
                 ORDER BY created_at",
            )?;
            let rows = statement.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()
        })?;
        for group in groups {
            self.sync_one(&group)?;
        }
        // KeyPackages, blocks and mutes set on another device of this
        // account and the push token: the next sync tries each again,
        // unless this build is too old to be served at all (0030).
        too_old(self.restock())?;
        self.refresh_profiles()?;
        too_old(self.refresh_blocks())?;
        too_old(self.refresh_mutes())?;
        too_old(self.send_push_token())?;
        self.purge()?;
        self.sweep_media()?;
        Ok(std::mem::take(&mut self.outcome))
    }

    /// Deletes what has disappeared and its files: the `Expired` events,
    /// which `sync` and `on_frame` also return. The app calls it when an
    /// item on screen reaches its `expires_at`.
    pub fn expire(&mut self) -> Result<Outcome, ClientError> {
        self.purge()?;
        Ok(std::mem::take(&mut self.outcome))
    }

    /// Every call that reads the timeline purges first; the events wait
    /// for the next call that returns an outcome.
    fn purge(&mut self) -> Result<(), ClientError> {
        let (removed, objects) = self
            .store
            .try_write(|tx| Ok::<_, ClientError>(timeline::purge(tx, now())?))?;
        self.remove_media(&objects);
        self.outcome
            .events
            .extend(removed.into_iter().map(|(group, removed)| Event::Expired {
                conversation: conversation_id(&group),
                removed,
            }));
        Ok(())
    }

    /// Fetches the names and marks of accounts met since, or not fetched
    /// for a day. One the server does not answer waits for the next call.
    fn refresh_profiles(&mut self) -> Result<(), ClientError> {
        let (me, wanted) = self.store.try_write(|tx| {
            let (_, me) = this_device(tx)?;
            Ok::<_, ClientError>((me.account, members::unfetched(tx)?))
        })?;
        if wanted.is_empty() {
            return Ok(());
        }
        let api = authed(&self.transport, &self.token, &self.client)?;
        let mut fetched = Vec::new();
        for account in wanted {
            // The server names other accounts only to co-members; this one's
            // own name comes from `/v1/me`.
            let profile = if account == me {
                api.me().map(|me| Profile {
                    name: me.name,
                    verified: me.verified,
                })
            } else {
                api.profile(&account)
            };
            match profile {
                Ok(profile) => fetched.push((account, Some(profile))),
                Err(ApiError::Refused { status: 404, .. }) => fetched.push((account, None)),
                Err(error @ ApiError::ClientTooOld { .. }) => return Err(error.into()),
                Err(_) => {}
            }
        }
        if fetched.is_empty() {
            return Ok(());
        }
        self.store.try_write(|tx| {
            fetched.iter().try_for_each(|(account, profile)| {
                members::store_profile(tx, account, profile.as_ref())
            })
        })?;
        self.outcome.events.push(Event::Profiles {
            accounts: fetched.into_iter().map(|(account, _)| account).collect(),
        });
        Ok(())
    }

    /// One frame from the socket.
    pub fn on_frame(&mut self, text: &str) -> Result<Outcome, ClientError> {
        let frame: Incoming =
            serde_json::from_str(text).map_err(|_| ClientError::Protocol("frame"))?;
        match frame {
            Incoming::Ping { nonce } => {
                let pong = match nonce {
                    Some(nonce) => serde_json::json!({ "type": "pong", "nonce": nonce }),
                    None => serde_json::json!({ "type": "pong" }),
                };
                self.outcome.frames.push(pong.to_string());
            }
            Incoming::Notify { conversation, seq } => {
                let group =
                    group_id(&conversation).ok_or(ClientError::Protocol("conversation id"))?;
                let known = self.store.try_write(|tx| conversation_of(tx, &group))?;
                match known {
                    Some((State::New | State::Active | State::Excluded, cursor))
                        if seq > cursor =>
                    {
                        self.sync_one(&group)?
                    }
                    Some((State::Stale, _)) => self.sync_one(&group)?,
                    Some(_) => {}
                    None => self.join(&group)?,
                }
                self.refresh_profiles()?;
            }
            Incoming::Typing {
                conversation,
                ciphertext,
            } => {
                let group =
                    group_id(&conversation).ok_or(ClientError::Protocol("conversation id"))?;
                let sealed =
                    api::from_base64(&ciphertext).ok_or(ClientError::Protocol("typing"))?;
                let opened = self.store.try_write(|tx| {
                    if conversation_of(tx, &group)?.map(|c| c.0) != Some(State::Active)
                        || !read::settings(tx)?.typing
                    {
                        return Ok(None);
                    }
                    let provider = Provider::new(tx);
                    Ok::<_, ClientError>(
                        Group::load(&provider, &group)?.open_typing(&provider, &sealed),
                    )
                })?;
                if let Some(Ok(Envelope {
                    body: Body::Typing { active },
                    ..
                })) = opened.map(|o| Envelope::decode(&o))
                {
                    self.outcome.events.push(Event::Typing {
                        conversation,
                        active,
                    });
                }
            }
            Incoming::Mute {
                conversation,
                muted,
                until,
            } => self.on_mute(&conversation, muted, until)?,
            Incoming::Hello {} | Incoming::Other => {}
        }
        self.purge()?;
        Ok(std::mem::take(&mut self.outcome))
    }

    /// Joins again first if this device is `Stale`, and once more if the
    /// exchange leaves it so.
    fn sync_one(&mut self, group: &[u8]) -> Result<(), ClientError> {
        let stale = |client: &mut Self| -> Result<bool, ClientError> {
            Ok(client.store.try_write(|tx| conversation_state(tx, group))? == State::Stale)
        };
        for _ in 0..2 {
            if stale(self)? && !self.join_external(group)? {
                return Ok(());
            }
            self.exchange(group)?;
            if !stale(self)? {
                break;
            }
        }
        if self.check_devices(group)? {
            self.exchange(group)?;
        }
        Ok(())
    }

    /// Queues the removal of every leaf the server no longer serves: a
    /// revoked device, or a deleted account's (0028). At most hourly per
    /// conversation, or at once after the server refused a claim naming a
    /// departed account. Not while a correction is queued: a claim that
    /// left an account out is set right first, so a forged roster never
    /// makes an honest member remove anyone. True when one was queued.
    fn check_devices(&mut self, group: &[u8]) -> Result<bool, ClientError> {
        let due = self.store.try_write(|tx| {
            let row: Option<(String, Option<i64>, bool)> = tx
                .query_row(
                    &format!(
                        "SELECT {STATE}, devices_checked_at,
                             EXISTS (SELECT 1 FROM outbox o WHERE o.group_id = c.group_id
                                     AND o.kind IN ('correct', 'remove_devices')
                                     AND o.seq IS NULL)
                         FROM conversations c WHERE group_id = ?1"
                    ),
                    [group],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            Ok::<_, ClientError>(match row {
                Some((state, at, false)) if state == State::Active.as_str() => {
                    at.is_none_or(|at| at + DEVICES_CHECK_EVERY <= now())
                }
                _ => false,
            })
        })?;
        if !due {
            return Ok(false);
        }
        let conversation = conversation_id(group);
        let served = match authed(&self.transport, &self.token, &self.client)?
            .conversation_devices(&conversation)
        {
            Ok(served) => served,
            // The next fetch learns why.
            Err(ApiError::Refused { .. }) => return Ok(false),
            Err(error) => return Err(error.into()),
        };
        self.store.try_write(|tx| {
            tx.execute(
                "UPDATE conversations SET devices_checked_at = ?2 WHERE group_id = ?1",
                params![group, now()],
            )?;
            let provider = Provider::new(tx);
            let mls = Group::load(&provider, group)?;
            let (_, me) = this_device(tx)?;
            let gone: Vec<String> = mls
                .devices()?
                .into_iter()
                .filter(|d| {
                    *d != me
                        && !served
                            .iter()
                            .any(|(a, ds)| *a == d.account && ds.contains(&d.device))
                })
                .map(|d| d.identity())
                .collect();
            if gone.is_empty() {
                return Ok(false);
            }
            enqueue(tx, group, "remove_devices", gone.join("\n").as_bytes())?;
            Ok::<_, ClientError>(true)
        })
    }

    fn exchange(&mut self, group: &[u8]) -> Result<(), ClientError> {
        loop {
            let drained = self.drain(group)?;
            if drained == Drain::Over {
                return Ok(());
            }
            let progressed = self.fetch(group)?;
            // A fetch can queue a correction, which a Done drain has not seen.
            let queued = drained == Drain::Done
                && self.store.try_write(|tx| correction_queued(tx, group))?;
            if !progressed || (drained == Drain::Done && !queued) {
                return Ok(());
            }
        }
    }

    /// Seals and sends outbox rows in order until one waits for a fetch.
    fn drain(&mut self, group: &[u8]) -> Result<Drain, ClientError> {
        let conversation = conversation_id(group);
        let state = self.store.try_write(|tx| conversation_state(tx, group))?;
        if state == State::Excluded {
            // The server refused the last send; a fetch learns if that changed.
            return Ok(Drain::Blocked);
        }
        if state == State::New {
            let created = authed(&self.transport, &self.token, &self.client)?
                .create_conversation(&conversation);
            match created {
                Ok(()) => {}
                Err(ApiError::Refused { status: 409, .. }) => {
                    return Err(ClientError::Protocol("a random group id was taken"));
                }
                Err(error) => return Err(self.failed(group, error)),
            }
            self.store
                .try_write(|tx| set_state(tx, group, State::Active))?;
        }
        loop {
            let Some(row) = self.store.try_write(|tx| next_unsent(tx, group))? else {
                return Ok(Drain::Done);
            };
            let out = match row.sealed {
                Some(out) => out,
                None => match self.seal(group, &row)? {
                    Sealed::Ready(out) => out,
                    Sealed::Blocked => return Ok(Drain::Blocked),
                    Sealed::Dropped => continue,
                },
            };
            let sent = authed(&self.transport, &self.token, &self.client)?
                .send_message(&conversation, &out);
            match sent {
                Ok(seq) => self.store.try_write(|tx| {
                    tx.execute(
                        "UPDATE outbox SET seq = ?2, failed = 0 WHERE id = ?1",
                        params![row.id, seq as i64],
                    )
                    .map(drop)
                })?,
                Err(ApiError::Refused {
                    status: 409, code, ..
                }) => {
                    // Another commit took this epoch. Forget ours, keep its
                    // intent, and seal it again once the fetch has caught up.
                    // A claim naming a departed account waits for the leaves
                    // the device check removes, which runs at once (0028).
                    self.store.try_write(|tx| {
                        unseal(tx, group, row.id)?;
                        if code == "claim_names_departed" {
                            tx.execute(
                                "UPDATE conversations SET devices_checked_at = NULL
                                 WHERE group_id = ?1",
                                [group],
                            )?;
                        }
                        Ok::<_, ClientError>(())
                    })?;
                    return Ok(Drain::Blocked);
                }
                Err(ApiError::Refused { status: 403, .. }) => {
                    // Not a member, by a claim this device has not read a
                    // commit for. Only a commit removes it (0020): keep the
                    // row to send once a correction restores this account.
                    self.store.try_write(|tx| {
                        unseal(tx, group, row.id)?;
                        Ok::<_, ClientError>(set_state(tx, group, State::Excluded)?)
                    })?;
                    return Ok(Drain::Over);
                }
                Err(error) => return Err(self.failed(group, error)),
            }
        }
    }

    /// A send got no answer: what this conversation has queued shows as
    /// failed until `retry` or the next send that gets through.
    fn failed(&mut self, group: &[u8], error: ApiError) -> ClientError {
        if matches!(error, ApiError::Unreachable(_)) {
            let marked = self.store.try_write(|tx| {
                tx.execute(
                    "UPDATE outbox SET failed = 1
                     WHERE group_id = ?1 AND kind = 'message' AND seq IS NULL",
                    [group],
                )
            });
            if let Err(stored) = marked {
                return stored.into();
            }
            self.outcome.events.push(Event::Timeline {
                conversation: conversation_id(group),
                changed: Vec::new(),
            });
        }
        error.into()
    }

    /// Seals one row into the bytes it is sent as from now on.
    fn seal(&mut self, group: &[u8], row: &Unsent) -> Result<Sealed, ClientError> {
        let intent_accounts = || split(String::from_utf8(row.intent.clone()).ok());
        // KeyPackages are claimed before the transaction: no request is
        // made while the store is locked.
        let mut claimed = Vec::new();
        if row.kind == Kind::Add {
            let api = authed(&self.transport, &self.token, &self.client)?;
            for account in intent_accounts() {
                match api.claim_key_packages(&account) {
                    Ok(packages) => {
                        for (device, key_package) in packages {
                            claimed.push(Claimed {
                                device: Device::new(&account, &device)?,
                                key_package,
                            });
                        }
                    }
                    // The account has no device left, or none with a
                    // KeyPackage still valid (0029): there is nothing to add.
                    Err(ApiError::Refused { status: 404, .. }) => {}
                    Err(ApiError::Refused {
                        status: 409, code, ..
                    }) if code == "no_key_packages" => {}
                    Err(error) => return Err(error.into()),
                }
            }
        }
        self.store.try_write(|tx| {
            // Another process sharing the store may have sealed it first.
            let unsealed: Option<bool> = tx
                .query_row(
                    "SELECT ciphertext IS NULL FROM outbox WHERE id = ?1",
                    [row.id],
                    |r| r.get(0),
                )
                .optional()?;
            if unsealed != Some(true) {
                return Ok(Sealed::Dropped);
            }
            let provider = Provider::new(tx);
            let mut mls = Group::load(&provider, group)?;
            if mls.has_pending_commit() {
                return Ok(Sealed::Blocked);
            }
            let identity = identity(tx, &provider)?;
            let (out, roster_add, roster_remove) = match row.kind {
                Kind::Message => (
                    Outgoing {
                        client_msg_id: Envelope::decode(&row.intent)?.id,
                        ciphertext: mls.encrypt(&provider, &identity, &row.intent)?,
                        welcome: None,
                        group_info: None,
                        urgent: urgent(&row.intent),
                    },
                    None,
                    None,
                ),
                // Never in the outbox unsealed.
                Kind::Join => return Err(ClientError::Protocol("an unsealed join")),
                Kind::Add | Kind::Remove | Kind::Correct | Kind::RemoveDevices => {
                    let commit = if row.kind == Kind::Correct {
                        Some(mls.correct(&provider, &identity)?)
                    } else if row.kind == Kind::Add {
                        // Devices a commit since this was queued already added.
                        let members = mls.devices()?;
                        claimed.retain(|c| !members.contains(&c.device));
                        (!claimed.is_empty())
                            .then(|| mls.add(&provider, &identity, &claimed))
                            .transpose()?
                    } else if row.kind == Kind::RemoveDevices {
                        // Leaves a commit since this was queued already removed.
                        let members = mls.devices()?;
                        let remove: Vec<Device> = String::from_utf8_lossy(&row.intent)
                            .split('\n')
                            .filter_map(|line| line.split_once('/'))
                            .filter_map(|(account, device)| Device::new(account, device).ok())
                            .filter(|d| members.contains(d) && d != identity.device())
                            .collect();
                        (!remove.is_empty())
                            .then(|| mls.remove_devices(&provider, &identity, &remove))
                            .transpose()?
                    } else {
                        let present = accounts(mls.devices()?);
                        let remove: Vec<String> = intent_accounts()
                            .into_iter()
                            .filter(|a| present.contains(a))
                            .collect();
                        (!remove.is_empty())
                            .then(|| mls.remove(&provider, &identity, &remove))
                            .transpose()?
                    };
                    let Some(commit) = commit else {
                        tx.execute("DELETE FROM outbox WHERE id = ?1", [row.id])?;
                        return Ok(Sealed::Dropped);
                    };
                    let changes = |accounts: &[String]| {
                        (row.kind != Kind::Correct)
                            .then(|| lines(accounts))
                            .flatten()
                    };
                    let (add, remove) = (changes(&commit.added), changes(&commit.removed));
                    (
                        Outgoing {
                            client_msg_id: random_id(),
                            ciphertext: commit.message,
                            welcome: commit.welcome,
                            group_info: Some(commit.group_info),
                            urgent: false,
                        },
                        add,
                        remove,
                    )
                }
            };
            tx.execute(
                "UPDATE outbox SET client_msg_id = ?2, ciphertext = ?3, roster_add = ?4,
                     roster_remove = ?5, welcome = ?6, group_info = ?7
                 WHERE id = ?1",
                params![
                    row.id,
                    out.client_msg_id,
                    out.ciphertext,
                    roster_add,
                    roster_remove,
                    out.welcome,
                    out.group_info,
                ],
            )?;
            Ok::<_, ClientError>(Sealed::Ready(out))
        })
    }

    /// Fetches and processes everything after the cursor. True when the
    /// cursor moved.
    fn fetch(&mut self, group: &[u8]) -> Result<bool, ClientError> {
        let conversation = conversation_id(group);
        let mut progressed = false;
        'pages: loop {
            let Some((state @ (State::Active | State::Excluded), cursor)) =
                self.store.try_write(|tx| conversation_of(tx, group))?
            else {
                break;
            };
            let api::Page { messages, more } =
                match authed(&self.transport, &self.token, &self.client)?
                    .list_messages(&conversation, cursor)
                {
                    Ok(page) => page,
                    // Past the commit that left this account out, by a claim
                    // this device may not have seen backed (0020).
                    Err(ApiError::Refused { status: 403, .. }) => {
                        self.store
                            .try_write(|tx| set_state(tx, group, State::Excluded))?;
                        break;
                    }
                    Err(error) => return Err(error.into()),
                };
            if state == State::Excluded {
                self.store
                    .try_write(|tx| set_state(tx, group, State::Active))?;
            }
            for (seq, bytes) in messages {
                let (next, events) = self.store.try_write(|tx| receive(tx, group, seq, &bytes))?;
                self.outcome.events.extend(events);
                match next {
                    Next::Moved => progressed = true,
                    Next::Already => {}
                    Next::Stop => break 'pages,
                }
            }
            if !more {
                break;
            }
        }
        if progressed {
            let cursor = self
                .store
                .try_write(|tx| conversation_of(tx, group))?
                .map_or(0, |c| c.1);
            self.outcome.frames.push(ack(&conversation, cursor));
        }
        Ok(progressed)
    }

    /// A conversation this device is not in yet: join it from the Welcome
    /// that added this account, or else from the GroupInfo (0021), and read
    /// what came after it.
    fn join(&mut self, group: &[u8]) -> Result<(), ClientError> {
        let conversation = conversation_id(group);
        match authed(&self.transport, &self.token, &self.client)?.get_welcome(&conversation) {
            Ok((seq, welcome)) => {
                let welcomed = self.store.try_write(|tx| {
                    if conversation_of(tx, group)?.is_some() {
                        return Ok(Welcomed::Already);
                    }
                    let provider = Provider::new(tx);
                    let mls = match Group::join(&provider, &welcome) {
                        Ok(mls) => mls,
                        Err(GroupError::Storage(error)) => {
                            return Err(GroupError::Storage(error).into());
                        }
                        // A Welcome for this account's other devices only.
                        Err(_) => return Ok(Welcomed::NotThisDevice),
                    };
                    if mls.id() != group {
                        return Err(ClientError::Protocol("a Welcome for another group"));
                    }
                    tx.execute(
                        "INSERT INTO conversations (group_id, state, cursor, created_at)
                         VALUES (?1, 'active', ?2, ?3)",
                        params![group, seq as i64, now()],
                    )?;
                    refresh_members(tx, group, &mls)?;
                    Ok::<_, ClientError>(Welcomed::Joined)
                })?;
                match welcomed {
                    Welcomed::Already => return Ok(()),
                    Welcomed::Joined => {
                        self.outcome.events.push(Event::Joined { conversation });
                        return self.sync_one(group);
                    }
                    Welcomed::NotThisDevice => {}
                }
            }
            // Not a conversation of this account.
            Err(ApiError::Refused { status: 403, .. }) => return Ok(()),
            // No Welcome names this account: it was in the conversation
            // before this device was.
            Err(ApiError::Refused { status: 404, .. }) => {}
            Err(error) => return Err(error.into()),
        }
        if self.join_external(group)? {
            self.sync_one(group)?;
        }
        Ok(())
    }

    /// Joins by an external commit (0021), before anything else is sent in
    /// this conversation. A join the server has not answered is sent again
    /// as the same bytes; one another commit beat is made again from the
    /// newer GroupInfo. True once the server has it; the cursor is then its
    /// seq, as nothing before it can be read.
    fn join_external(&mut self, group: &[u8]) -> Result<bool, ClientError> {
        let conversation = conversation_id(group);
        for _ in 0..JOIN_ATTEMPTS {
            let (id, out) = match self.store.try_write(|tx| pending_join(tx, group))? {
                Some(pending) => pending,
                None => {
                    let api = authed(&self.transport, &self.token, &self.client)?;
                    let group_info = match api.get_group_info(&conversation) {
                        Ok((_, group_info)) => group_info,
                        Err(ApiError::Refused {
                            status: 403 | 404, ..
                        }) => return Ok(false),
                        Err(error) => return Err(error.into()),
                    };
                    self.store
                        .try_write(|tx| seal_join(tx, group, &group_info))?
                }
            };
            match authed(&self.transport, &self.token, &self.client)?
                .send_message(&conversation, &out)
            {
                Ok(seq) => {
                    self.store.try_write(|tx| {
                        tx.execute("DELETE FROM outbox WHERE id = ?1", [id])?;
                        tx.execute(
                            "UPDATE conversations SET cursor = ?2 WHERE group_id = ?1",
                            params![group, seq as i64],
                        )?;
                        set_state(tx, group, State::Active)
                    })?;
                    self.outcome.events.push(Event::Joined { conversation });
                    return Ok(true);
                }
                // The tree still holds a departed account's leaves, which a
                // member's device check removes (0028); a later sync joins.
                Err(ApiError::Refused {
                    status: 409, code, ..
                }) if code == "claim_names_departed" => {
                    self.store.try_write(|tx| drop_join(tx, group, id))?;
                    return Ok(false);
                }
                Err(ApiError::Refused { status: 409, .. }) => {
                    self.store.try_write(|tx| drop_join(tx, group, id))?;
                }
                Err(ApiError::Refused { status: 403, .. }) => {
                    self.store.try_write(|tx| drop_join(tx, group, id))?;
                    return Ok(false);
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(false)
    }
}

enum Welcomed {
    Joined,
    /// Another process sharing the store joined first.
    Already,
    NotThisDevice,
}

enum Next {
    Moved,
    /// Another process stored it first.
    Already,
    Stop,
}

/// One stored message, in its own transaction: decrypted or recognised as
/// this device's own, stored, and the cursor moved past it.
fn receive(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    bytes: &[u8],
) -> Result<(Next, Vec<Event>), ClientError> {
    let conversation = conversation_id(group);
    let Some((State::Active, cursor)) = conversation_of(tx, group)? else {
        return Ok((Next::Stop, Vec::new()));
    };
    if seq <= cursor {
        return Ok((Next::Already, Vec::new()));
    }
    let stale = || -> Result<(Next, Vec<Event>), ClientError> {
        set_state(tx, group, State::Stale)?;
        Ok((
            Next::Stop,
            vec![Event::Stale {
                conversation: conversation.clone(),
            }],
        ))
    };
    if seq != cursor + 1 {
        // What came between expired before this device fetched it.
        return stale();
    }
    let provider = Provider::new(tx);
    let mut mls = Group::load(&provider, group)?;
    let (_, me) = this_device(tx)?;
    let mut events = Vec::new();
    let timeline = |changed: Option<Vec<u64>>| {
        changed.map(|changed| Event::Timeline {
            conversation: conversation.clone(),
            changed,
        })
    };
    type Own = (i64, String, Vec<u8>, Option<String>, Option<String>);
    let own: Option<Own> = tx
        .query_row(
            "SELECT id, kind, intent, roster_add, roster_remove FROM outbox
             WHERE group_id = ?1 AND seq = ?2",
            params![group, seq as i64],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    if let Some((id, kind, intent, roster_add, roster_remove)) = own {
        if Kind::parse(&kind)? == Kind::Message {
            store_message(tx, group, seq, &me, &intent, false)?;
            let envelope = Envelope::decode(&intent)?;
            let changed = fold(tx, group, seq, &me, &envelope, &me.account)?;
            events.push(Event::Message(Message {
                conversation: conversation.clone(),
                seq,
                sender: me,
                envelope,
                own: true,
            }));
            events.extend(timeline(changed));
        } else {
            mls.merge_pending_commit(&provider)?;
            refresh_members(tx, group, &mls)?;
            // An own claim is always backed.
            drop_correction(tx, group)?;
            let (added, removed) = (split(roster_add), split(roster_remove));
            let card = fold_members(
                tx,
                group,
                seq,
                &me,
                added.clone(),
                removed.clone(),
                Vec::new(),
            )?;
            events.extend(timeline(card.map(|seq| vec![seq])));
            if !added.is_empty() || !removed.is_empty() {
                events.push(Event::Membership {
                    conversation: conversation.clone(),
                    added,
                    removed,
                });
            }
        }
        tx.execute("DELETE FROM outbox WHERE id = ?1", [id])?;
    } else {
        match mls.process(&provider, bytes) {
            Ok(Received::Application { sender, plaintext }) => match Envelope::decode(&plaintext) {
                // Typing never travels as a stored message; one that does is dropped.
                Ok(Envelope {
                    body: Body::Typing { .. },
                    ..
                }) => {}
                // A blocked account's message is kept hidden: no item, no
                // count, no event (0024).
                Ok(_) if sender != me && block::is_blocked(tx, &sender.account)? => {
                    store_message(tx, group, seq, &sender, &plaintext, true)?;
                }
                Ok(envelope) => {
                    store_message(tx, group, seq, &sender, &plaintext, false)?;
                    let changed = fold(tx, group, seq, &sender, &envelope, &me.account)?;
                    events.push(Event::Message(Message {
                        conversation: conversation.clone(),
                        own: sender == me,
                        sender,
                        seq,
                        envelope,
                    }));
                    events.extend(timeline(changed));
                }
                // Unreadable plaintext is skipped; the group is still in step.
                Err(_) => {}
            },
            Ok(Received::Commit {
                removed_self: true,
                by,
                ..
            }) => {
                set_state(tx, group, State::Removed)?;
                let card = fold_members(
                    tx,
                    group,
                    seq,
                    &by,
                    Vec::new(),
                    vec![me.account.clone()],
                    Vec::new(),
                )?;
                events.push(Event::Removed {
                    conversation: conversation.clone(),
                });
                events.extend(timeline(card.map(|seq| vec![seq])));
            }
            Ok(Received::Commit {
                by,
                added,
                removed,
                backed,
                joined,
                ..
            }) => {
                if backed {
                    drop_correction(tx, group)?;
                } else {
                    queue_correction(tx, group)?;
                }
                refresh_members(tx, group, &mls)?;
                // An account that keeps a leaf is still a member: removing a
                // revoked device of it changes no one (0028).
                let present = accounts(mls.devices()?);
                let removed: Vec<Device> = removed
                    .into_iter()
                    .filter(|d| !present.contains(&d.account))
                    .collect();
                let card = fold_members(
                    tx,
                    group,
                    seq,
                    &by,
                    accounts(added.clone()),
                    accounts(removed.clone()),
                    accounts(joined.clone()),
                )?;
                events.extend(timeline(card.map(|seq| vec![seq])));
                if !added.is_empty() || !removed.is_empty() {
                    events.push(Event::Membership {
                        conversation: conversation.clone(),
                        added: accounts(added),
                        removed: accounts(removed),
                    });
                }
                if !joined.is_empty() {
                    events.push(Event::Devices {
                        conversation: conversation.clone(),
                        joined,
                    });
                }
            }
            Ok(Received::Proposal | Received::Own) => {}
            Err(GroupError::Storage(error)) => return Err(GroupError::Storage(error).into()),
            // An application message from too far back, or one that would
            // not decrypt, is lost on its own; a commit this device cannot
            // follow, or anything from an epoch ahead, leaves it behind.
            Err(GroupError::Epoch { message, group: at }) if message < at && !is_commit(bytes) => {}
            Err(GroupError::Epoch { .. }) => return stale(),
            Err(_) if is_commit(bytes) => return stale(),
            Err(_) => {}
        }
    }
    tx.execute(
        "UPDATE conversations SET cursor = ?2 WHERE group_id = ?1",
        params![group, seq as i64],
    )?;
    let next = match conversation_of(tx, group)? {
        Some((State::Active, _)) => Next::Moved,
        _ => Next::Stop,
    };
    Ok((next, events))
}
