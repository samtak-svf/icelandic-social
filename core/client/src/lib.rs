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

mod account;
pub mod api;

use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub use account::{SignedIn, invite_token};
use api::{Api, ApiError, Outgoing, Transport, conversation_id, group_id};
use serde::Deserialize;
use spjall_envelope::{Body, Envelope, EnvelopeError};
use spjall_mls::group::{
    Claimed, Device, Group, GroupError, Identity, Received, generate_device_key, is_commit,
};
use spjall_mls::storage::Provider;
use spjall_store::rusqlite::{self, OptionalExtension, Transaction, params};
use spjall_store::{Key, Store};

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
    /// expired before it fetched them, or a commit it could not process.
    /// Rejoining is not built yet (0018).
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conversation {
    pub id: String,
    pub state: State,
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
pub enum Event {
    Message(Message),
    Membership {
        conversation: String,
        added: Vec<String>,
        removed: Vec<String>,
    },
    Joined {
        conversation: String,
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
}

impl Kind {
    fn parse(text: &str) -> rusqlite::Result<Self> {
        Ok(match text {
            "message" => Self::Message,
            "add" => Self::Add,
            "remove" => Self::Remove,
            "correct" => Self::Correct,
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

/// The first row of this conversation the server has not answered.
fn next_unsent(tx: &Transaction, group: &[u8]) -> Result<Option<Unsent>, ClientError> {
    type Row = (
        i64,
        String,
        Vec<u8>,
        Option<String>,
        Option<Vec<u8>>,
        Option<Vec<u8>>,
    );
    let row: Option<Row> = tx
        .query_row(
            "SELECT id, kind, intent, client_msg_id, ciphertext, welcome
             FROM outbox WHERE group_id = ?1 AND seq IS NULL ORDER BY id LIMIT 1",
            [group],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()?;
    let Some((id, kind, intent, client_msg_id, ciphertext, welcome)) = row else {
        return Ok(None);
    };
    let sealed = client_msg_id
        .zip(ciphertext)
        .map(|(client_msg_id, ciphertext)| Outgoing {
            client_msg_id,
            ciphertext,
            welcome,
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
             roster_add = NULL, roster_remove = NULL, welcome = NULL
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

fn store_message(
    tx: &Transaction,
    group: &[u8],
    seq: u64,
    sender: &Device,
    envelope: &[u8],
) -> rusqlite::Result<()> {
    tx.execute(
        "INSERT INTO messages (group_id, seq, sender_account, sender_device, envelope, stored_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            group,
            seq as i64,
            sender.account,
            sender.device,
            envelope,
            now()
        ],
    )
    .map(drop)
}

/// The API as this device, which needs its token.
fn authed<'a, T: Transport>(
    transport: &'a T,
    token: &'a Option<String>,
) -> Result<Api<'a, T>, ClientError> {
    let token = token.as_deref().ok_or(ClientError::NotRegistered)?;
    Ok(Api::new(transport, Some(token)))
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
}

impl<T: Transport> Client<T> {
    pub fn open(dir: &Path, key: &Key, transport: T) -> Result<Self, ClientError> {
        let mut store = Store::open(dir, key)?;
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
        })
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
    /// at a time, with a fresh last-resort package whenever it uploads.
    /// Returns how many the server holds.
    pub fn stock_key_packages(&mut self, target: u32) -> Result<u32, ClientError> {
        let api = authed(&self.transport, &self.token)?;
        let available = api.upload_key_packages(&[], None)?;
        if available >= target {
            return Ok(available);
        }
        let n = (target - available).min(100) as usize;
        let (packages, last_resort) = self.store.try_write(|tx| {
            let provider = Provider::new(tx);
            let identity = identity(tx, &provider)?;
            Ok::<_, ClientError>((
                identity.key_packages(&provider, n)?,
                identity.last_resort(&provider)?,
            ))
        })?;
        Ok(api.upload_key_packages(&packages, Some(&last_resort))?)
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

    /// A typing frame for the socket, sealed on the current epoch.
    pub fn typing(&mut self, conversation: &str, active: bool) -> Result<String, ClientError> {
        let group = group_id(conversation).ok_or(ClientError::UnknownConversation)?;
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
            let provider = Provider::new(tx);
            Ok(Group::load(&provider, &group)?.seal_typing(&provider, &envelope)?)
        })?;
        Ok(serde_json::json!({
            "type": "typing",
            "conversationId": conversation,
            "ciphertext": api::base64(&sealed),
        })
        .to_string())
    }

    pub fn conversations(&mut self) -> Result<Vec<Conversation>, ClientError> {
        self.store.try_write(|tx| {
            let mut statement = tx.prepare(&format!(
                "SELECT group_id, {STATE} FROM conversations ORDER BY created_at"
            ))?;
            let rows = statement.query_map([], |r| {
                Ok(Conversation {
                    id: conversation_id(&r.get::<_, Vec<u8>>(0)?),
                    state: State::parse(&r.get::<_, String>(1)?)?,
                })
            })?;
            Ok(rows.collect::<Result<_, _>>()?)
        })
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
                 WHERE group_id = ?1 AND seq < ?2 ORDER BY seq DESC LIMIT ?3",
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
                "SELECT group_id FROM conversations WHERE state IN ('new', 'active')
                 ORDER BY created_at",
            )?;
            let rows = statement.query_map([], |r| r.get(0))?;
            rows.collect::<rusqlite::Result<_>>()
        })?;
        for group in groups {
            self.sync_one(&group)?;
        }
        Ok(std::mem::take(&mut self.outcome))
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
                    Some(_) => {}
                    None => self.join(&group)?,
                }
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
                    if conversation_of(tx, &group)?.map(|c| c.0) != Some(State::Active) {
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
            Incoming::Hello {} | Incoming::Other => {}
        }
        Ok(std::mem::take(&mut self.outcome))
    }

    fn sync_one(&mut self, group: &[u8]) -> Result<(), ClientError> {
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
            match authed(&self.transport, &self.token)?.create_conversation(&conversation) {
                Ok(()) => {}
                Err(ApiError::Refused { status: 409, .. }) => {
                    return Err(ClientError::Protocol("a random group id was taken"));
                }
                Err(error) => return Err(error.into()),
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
            match authed(&self.transport, &self.token)?.send_message(&conversation, &out) {
                Ok(seq) => self.store.try_write(|tx| {
                    tx.execute(
                        "UPDATE outbox SET seq = ?2 WHERE id = ?1",
                        params![row.id, seq as i64],
                    )
                    .map(drop)
                })?,
                Err(ApiError::Refused { status: 409, .. }) => {
                    // Another commit took this epoch. Forget ours, keep its
                    // intent, and seal it again once the fetch has caught up.
                    self.store.try_write(|tx| unseal(tx, group, row.id))?;
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
                Err(error) => return Err(error.into()),
            }
        }
    }

    /// Seals one row into the bytes it is sent as from now on.
    fn seal(&mut self, group: &[u8], row: &Unsent) -> Result<Sealed, ClientError> {
        let intent_accounts = || split(String::from_utf8(row.intent.clone()).ok());
        // KeyPackages are claimed before the transaction: no request is
        // made while the store is locked.
        let mut claimed = Vec::new();
        if row.kind == Kind::Add {
            let api = authed(&self.transport, &self.token)?;
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
                    // The account has no device left: there is nothing to add.
                    Err(ApiError::Refused { status: 404, .. }) => {}
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
                    },
                    None,
                    None,
                ),
                Kind::Add | Kind::Remove | Kind::Correct => {
                    let commit = if row.kind == Kind::Correct {
                        Some(mls.correct(&provider, &identity)?)
                    } else if row.kind == Kind::Add {
                        // Devices a commit since this was queued already added.
                        let members = mls.devices()?;
                        claimed.retain(|c| !members.contains(&c.device));
                        (!claimed.is_empty())
                            .then(|| mls.add(&provider, &identity, &claimed))
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
                        },
                        add,
                        remove,
                    )
                }
            };
            tx.execute(
                "UPDATE outbox SET client_msg_id = ?2, ciphertext = ?3, roster_add = ?4,
                     roster_remove = ?5, welcome = ?6
                 WHERE id = ?1",
                params![
                    row.id,
                    out.client_msg_id,
                    out.ciphertext,
                    roster_add,
                    roster_remove,
                    out.welcome,
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
                match authed(&self.transport, &self.token)?.list_messages(&conversation, cursor) {
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
    /// that added this account, and read what came after it.
    fn join(&mut self, group: &[u8]) -> Result<(), ClientError> {
        let conversation = conversation_id(group);
        let (seq, welcome) = match authed(&self.transport, &self.token)?.get_welcome(&conversation)
        {
            Ok(found) => found,
            Err(ApiError::Refused {
                status: 403 | 404, ..
            }) => return Ok(()),
            Err(error) => return Err(error.into()),
        };
        let joined = self.store.try_write(|tx| {
            if conversation_of(tx, group)?.is_some() {
                return Ok(false);
            }
            let provider = Provider::new(tx);
            let mls = match Group::join(&provider, &welcome) {
                Ok(mls) => mls,
                Err(GroupError::Storage(error)) => return Err(GroupError::Storage(error).into()),
                // A Welcome for this account's other devices only, which this
                // core does not handle yet (0018).
                Err(_) => return Ok(false),
            };
            if mls.id() != group {
                return Err(ClientError::Protocol("a Welcome for another group"));
            }
            tx.execute(
                "INSERT INTO conversations (group_id, state, cursor, created_at)
                 VALUES (?1, 'active', ?2, ?3)",
                params![group, seq as i64, now()],
            )?;
            Ok::<_, ClientError>(true)
        })?;
        if joined {
            self.outcome.events.push(Event::Joined { conversation });
            self.fetch(group)?;
        }
        Ok(())
    }
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
            store_message(tx, group, seq, &me, &intent)?;
            events.push(Event::Message(Message {
                conversation: conversation.clone(),
                seq,
                sender: me,
                envelope: Envelope::decode(&intent)?,
                own: true,
            }));
        } else {
            mls.merge_pending_commit(&provider)?;
            // An own claim is always backed.
            drop_correction(tx, group)?;
            let (added, removed) = (split(roster_add), split(roster_remove));
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
                Ok(envelope) => {
                    store_message(tx, group, seq, &sender, &plaintext)?;
                    events.push(Event::Message(Message {
                        conversation: conversation.clone(),
                        own: sender == me,
                        sender,
                        seq,
                        envelope,
                    }));
                }
                // Unreadable plaintext is skipped; the group is still in step.
                Err(_) => {}
            },
            Ok(Received::Commit {
                removed_self: true, ..
            }) => {
                set_state(tx, group, State::Removed)?;
                events.push(Event::Removed {
                    conversation: conversation.clone(),
                });
            }
            Ok(Received::Commit {
                added,
                removed,
                backed,
                ..
            }) => {
                if backed {
                    drop_correction(tx, group)?;
                } else {
                    queue_correction(tx, group)?;
                }
                if !added.is_empty() || !removed.is_empty() {
                    events.push(Event::Membership {
                        conversation: conversation.clone(),
                        added: accounts(added),
                        removed: accounts(removed),
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
