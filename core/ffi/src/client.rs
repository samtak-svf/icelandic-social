//! The client of decision 0018 as the apps see it. The app implements
//! `Transport` over OkHttp or URLSession, owns the WebSocket, and calls
//! `CoreClient` off the main thread: every call may block on the network.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use spjall_client::{self as core, ClientError, api};

use crate::{Body, CoreError, Envelope};

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum HttpMethod {
    Get,
    Post,
    Delete,
}

/// A request to the API. `path` starts at `/v1/` and holds any query. The
/// transport adds the base URL, `Authorization: Bearer <bearer>` when there
/// is a bearer, and `content-type: application/json` when there is a body.
/// The bearer is the device token: the transport never logs it.
#[derive(Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub path: String,
    pub body: Option<String>,
    pub bearer: Option<String>,
}

/// The method and path only: the body can hold a sign-in's verifier.
impl std::fmt::Debug for HttpRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?} {}", self.method, self.path)
    }
}

/// Any answer the server gave, whatever its status.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

/// No answer came back: no network, a timeout, a dropped connection.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum TransportError {
    #[error("{detail}")]
    Unreachable { detail: String },
}

impl From<uniffi::UnexpectedUniFFICallbackError> for TransportError {
    fn from(error: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::Unreachable {
            detail: error.to_string(),
        }
    }
}

/// What the app provides: one blocking HTTP request.
#[uniffi::export(with_foreign)]
pub trait Transport: Send + Sync {
    fn request(&self, request: HttpRequest) -> Result<HttpResponse, TransportError>;
}

struct Foreign(Arc<dyn Transport>);

impl api::Transport for Foreign {
    fn request(&self, request: api::Request) -> Result<api::Response, api::Unreachable> {
        let request = HttpRequest {
            method: match request.method {
                api::Method::Get => HttpMethod::Get,
                api::Method::Post => HttpMethod::Post,
                api::Method::Delete => HttpMethod::Delete,
            },
            path: request.path,
            body: request.body,
            bearer: request.bearer,
        };
        match self.0.request(request) {
            Ok(response) => Ok(api::Response {
                status: response.status,
                body: response.body,
            }),
            Err(TransportError::Unreachable { detail }) => Err(api::Unreachable(detail)),
        }
    }
}

impl From<ClientError> for CoreError {
    fn from(error: ClientError) -> Self {
        match error {
            ClientError::Store(error) => error.into(),
            ClientError::Mls(error) => Self::Mls {
                detail: error.to_string(),
            },
            ClientError::Transport(api::ApiError::Unreachable(api::Unreachable(detail))) => {
                Self::Unreachable { detail }
            }
            ClientError::Transport(api::ApiError::Refused { status, code }) => {
                Self::Refused { status, code }
            }
            ClientError::Transport(api::ApiError::Malformed(what)) => Self::Protocol {
                detail: format!("malformed answer to {what}"),
            },
            ClientError::Envelope(error) => error.into(),
            ClientError::NotRegistered => Self::NotRegistered,
            ClientError::UnknownConversation => Self::UnknownConversation,
            ClientError::Invalid(detail) => Self::Invalid {
                detail: detail.into(),
            },
            ClientError::Protocol(detail) => Self::Protocol {
                detail: detail.into(),
            },
            ClientError::SignIn(detail) => Self::SignIn { detail },
        }
    }
}

/// Which app is signing in; registerDevice records it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum Platform {
    Android,
    Ios,
}

impl From<Platform> for api::Platform {
    fn from(platform: Platform) -> Self {
        match platform {
            Platform::Android => Self::Android,
            Platform::Ios => Self::Ios,
        }
    }
}

impl From<api::Platform> for Platform {
    fn from(platform: api::Platform) -> Self {
        match platform {
            api::Platform::Android => Self::Android,
            api::Platform::Ios => Self::Ios,
        }
    }
}

/// The account and device this store is signed in as.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SignedIn {
    pub account_id: String,
    pub device_id: String,
}

impl From<core::SignedIn> for SignedIn {
    fn from(device: core::SignedIn) -> Self {
        Self {
            account_id: device.account,
            device_id: device.device,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct AccountDevice {
    pub device_id: String,
    pub platform: Platform,
    /// Milliseconds since the epoch.
    pub created_at: u64,
    /// This device.
    pub current: bool,
}

/// This account: the registry's name when Kenni gave one, and its devices.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Me {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    pub devices: Vec<AccountDevice>,
}

impl From<api::Me> for Me {
    fn from(me: api::Me) -> Self {
        Self {
            account_id: me.account_id,
            name: me.name,
            verified: me.verified,
            devices: me
                .devices
                .into_iter()
                .map(|d| AccountDevice {
                    device_id: d.device_id,
                    platform: d.platform.into(),
                    created_at: d.created_at,
                    current: d.current,
                })
                .collect(),
        }
    }
}

/// Who made an invite, as the person it was sent to sees them.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Inviter {
    /// The account the invite opens a 1:1 with.
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
}

/// The invite token in a link from the link host or the app's scheme, or
/// none for any other URL.
#[uniffi::export]
pub fn invite_token(link: String) -> Option<String> {
    core::invite_token(&link)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ConversationState {
    /// Made here; the server does not have it yet.
    New,
    Active,
    /// The server refuses this device, but no commit removed it; tried
    /// again on the next notify (0020).
    Excluded,
    /// A commit removed this account.
    Removed,
    /// This device missed what it needed to follow the group; it joins
    /// again on the next sync or notify (0021).
    Stale,
}

impl From<core::State> for ConversationState {
    fn from(state: core::State) -> Self {
        match state {
            core::State::New => Self::New,
            core::State::Active => Self::Active,
            core::State::Excluded => Self::Excluded,
            core::State::Removed => Self::Removed,
            core::State::Stale => Self::Stale,
        }
    }
}

/// An account as the screens show it: the name and mark the server gave,
/// none until the core has fetched them.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Person {
    pub account: String,
    pub name: Option<String>,
    pub verified: bool,
}

impl From<core::Person> for Person {
    fn from(person: core::Person) -> Self {
        Self {
            account: person.account,
            name: person.name,
            verified: person.verified,
        }
    }
}

fn people(people: Vec<core::Person>) -> Vec<Person> {
    people.into_iter().map(Into::into).collect()
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Conversation {
    pub id: String,
    pub state: ConversationState,
    /// Everyone here but this account, named ones first.
    pub members: Vec<Person>,
    /// The newest item, if any.
    pub last: Option<Item>,
    pub unread: u32,
    /// The disappearing timer, in seconds.
    pub timer: Option<u32>,
}

impl From<core::Conversation> for Conversation {
    fn from(conversation: core::Conversation) -> Self {
        Self {
            id: conversation.id,
            state: conversation.state.into(),
            members: people(conversation.members),
            last: conversation.last.map(Into::into),
            unread: conversation.unread,
            timer: conversation.timer,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ItemStatus {
    Sent,
    /// Queued, or sent and not yet fetched back.
    Pending,
    /// The last send got no answer; `retry()` sends it again.
    Failed,
}

impl From<core::Status> for ItemStatus {
    fn from(status: core::Status) -> Self {
        match status {
            core::Status::Sent => Self::Sent,
            core::Status::Pending => Self::Pending,
            core::Status::Failed => Self::Failed,
        }
    }
}

/// The message a reply answers, as it now is: no text once deleted, no
/// sender when it is not in this store.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Quote {
    pub envelope_id: String,
    pub sender: Option<Person>,
    pub text: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Content {
    Text {
        text: String,
        reply_to: Option<Quote>,
    },
    Media {
        mime: String,
        size: u64,
        caption: Option<String>,
    },
    /// Deleted for everyone.
    Deleted,
    /// A commit changed who is here: accounts added or removed, and new
    /// devices of accounts already here.
    Members {
        added: Vec<Person>,
        removed: Vec<Person>,
        devices: Vec<Person>,
    },
    /// The disappearing timer was set, or turned off.
    Timer { seconds: Option<u32> },
}

impl From<core::Content> for Content {
    fn from(content: core::Content) -> Self {
        use core::Content as C;
        match content {
            C::Text { text, reply_to } => Self::Text {
                text,
                reply_to: reply_to.map(|quote| Quote {
                    envelope_id: quote.envelope_id,
                    sender: quote.sender.map(Into::into),
                    text: quote.text,
                }),
            },
            C::Media {
                mime,
                size,
                caption,
            } => Self::Media {
                mime,
                size,
                caption,
            },
            C::Deleted => Self::Deleted,
            C::Members {
                added,
                removed,
                devices,
            } => Self::Members {
                added: people(added),
                removed: people(removed),
                devices: people(devices),
            },
            C::Timer { seconds } => Self::Timer { seconds },
        }
    }
}

/// One emoji on an item, with everyone who put it there.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Reaction {
    pub emoji: String,
    /// This account is one of them.
    pub own: bool,
    pub people: Vec<Person>,
}

/// A row of the conversation, folded: edits, deletes, reactions and
/// receipts are already applied.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Item {
    /// The id, and the order. None until the server answers.
    pub seq: Option<u64>,
    /// None for a card.
    pub envelope_id: Option<String>,
    /// The sender, or the account whose commit a card shows.
    pub sender: Person,
    /// Sent by this account, from any of its devices.
    pub own: bool,
    /// The sender's clock, in milliseconds; never used for order.
    pub ts: u64,
    pub status: ItemStatus,
    pub content: Content,
    pub edited: bool,
    pub reactions: Vec<Reaction>,
    /// How many accounts besides the sender have read it; counted for this
    /// account's own messages, and only with read markers on.
    pub read_by: u32,
    /// When it disappears, in milliseconds.
    pub expires_at: Option<u64>,
}

impl From<core::Item> for Item {
    fn from(item: core::Item) -> Self {
        Self {
            seq: item.seq,
            envelope_id: item.envelope_id,
            sender: item.sender.into(),
            own: item.own,
            ts: item.ts,
            status: item.status.into(),
            content: item.content.into(),
            edited: item.edited,
            reactions: item
                .reactions
                .into_iter()
                .map(|r| Reaction {
                    emoji: r.emoji,
                    own: r.own,
                    people: people(r.people),
                })
                .collect(),
            read_by: item.read_by,
            expires_at: item.expires_at,
        }
    }
}

/// The toggles of 0009. Off stops both sending and showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct Settings {
    pub read_markers: bool,
    pub typing: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Message {
    pub conversation: String,
    pub seq: u64,
    pub sender_account: String,
    pub sender_device: String,
    pub envelope: Envelope,
    /// Sent by this device.
    pub own: bool,
}

impl From<core::Message> for Message {
    fn from(message: core::Message) -> Self {
        Self {
            conversation: message.conversation,
            seq: message.seq,
            sender_account: message.sender.account,
            sender_device: message.sender.device,
            envelope: Envelope {
                id: message.envelope.id,
                ts: message.envelope.ts,
                body: message.envelope.body.into(),
            },
            own: message.own,
        }
    }
}

/// A device in a conversation's group.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GroupDevice {
    pub account: String,
    pub device: String,
}

/// What changed, for the app to show.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Event {
    Message {
        message: Message,
    },
    Membership {
        conversation: String,
        added: Vec<String>,
        removed: Vec<String>,
    },
    Joined {
        conversation: String,
    },
    /// Devices new to the group; one of an account already in it is the
    /// "new device" card of 0006.
    Devices {
        conversation: String,
        joined: Vec<GroupDevice>,
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
    /// Timeline items changed, by seq; `timeline()` gives them as they now
    /// are. Empty when only pending items changed.
    Timeline {
        conversation: String,
        changed: Vec<u64>,
    },
    /// Names or marks the server gave; `people()` has them.
    Profiles {
        accounts: Vec<String>,
    },
}

impl From<core::Event> for Event {
    fn from(event: core::Event) -> Self {
        use core::Event as E;
        match event {
            E::Message(message) => Self::Message {
                message: message.into(),
            },
            E::Membership {
                conversation,
                added,
                removed,
            } => Self::Membership {
                conversation,
                added,
                removed,
            },
            E::Joined { conversation } => Self::Joined { conversation },
            E::Devices {
                conversation,
                joined,
            } => Self::Devices {
                conversation,
                joined: joined
                    .into_iter()
                    .map(|d| GroupDevice {
                        account: d.account,
                        device: d.device,
                    })
                    .collect(),
            },
            E::Removed { conversation } => Self::Removed { conversation },
            E::Stale { conversation } => Self::Stale { conversation },
            E::Typing {
                conversation,
                active,
            } => Self::Typing {
                conversation,
                active,
            },
            E::Timeline {
                conversation,
                changed,
            } => Self::Timeline {
                conversation,
                changed,
            },
            E::Profiles { accounts } => Self::Profiles { accounts },
        }
    }
}

/// What a call produced: events to show, and frames to send on the socket.
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct Outcome {
    pub events: Vec<Event>,
    pub frames: Vec<String>,
}

impl From<core::Outcome> for Outcome {
    fn from(outcome: core::Outcome) -> Self {
        Self {
            events: outcome.events.into_iter().map(Into::into).collect(),
            frames: outcome.frames,
        }
    }
}

/// This device's client: one per process, over the store in `dir`.
#[derive(uniffi::Object)]
pub struct CoreClient {
    client: Mutex<core::Client<Foreign>>,
}

#[uniffi::export]
impl CoreClient {
    /// Opens (creating if needed) the store in `dir` with the platform's
    /// 32-byte key.
    #[uniffi::constructor]
    pub fn open(
        dir: String,
        key: Vec<u8>,
        transport: Arc<dyn Transport>,
    ) -> Result<Arc<Self>, CoreError> {
        let key: spjall_store::Key = key.try_into().map_err(|key: Vec<u8>| CoreError::Store {
            detail: format!("the store key must be 32 bytes, not {}", key.len()),
        })?;
        let client = core::Client::open(Path::new(&dir), &key, Foreign(transport))?;
        Ok(Arc::new(Self {
            client: Mutex::new(client),
        }))
    }

    /// This device's Ed25519 public key, made on first call: the
    /// `deviceKey` that registerDevice takes.
    pub fn device_key(&self) -> Result<Vec<u8>, CoreError> {
        Ok(self.client()?.device_key()?)
    }

    /// Starts a sign-in and returns the Kenni URL to open in Custom Tabs
    /// or `ASWebAuthenticationSession`. The sign-in waits in the store, so
    /// it survives the process ending while the browser is open; a new one
    /// replaces it.
    pub fn begin_sign_in(&self) -> Result<String, CoreError> {
        Ok(self.client()?.begin_sign_in()?)
    }

    /// Finishes the sign-in with the URL Kenni redirected to, and the
    /// invite token when the person has no account yet. `Unreachable`
    /// leaves the sign-in pending, so the same call can be made again; any
    /// other error ends it.
    pub fn complete_sign_in(
        &self,
        callback: String,
        invite_token: Option<String>,
        platform: Platform,
    ) -> Result<SignedIn, CoreError> {
        Ok(self
            .client()?
            .complete_sign_in(&callback, invite_token.as_deref(), platform.into())?
            .into())
    }

    /// The account and device this store is signed in as, if it is.
    pub fn signed_in(&self) -> Result<Option<SignedIn>, CoreError> {
        Ok(self.client()?.signed_in()?.map(Into::into))
    }

    /// The device token, for the WebSocket upgrade's `Authorization`.
    pub fn device_token(&self) -> Result<Option<String>, CoreError> {
        Ok(self.client()?.device_token().map(str::to_owned))
    }

    pub fn me(&self) -> Result<Me, CoreError> {
        Ok(self.client()?.me()?.into())
    }

    /// Who made an invite; none for the operator's. Needs no sign-in. A
    /// link that does not work is `Refused` with 404.
    pub fn resolve_invite(&self, token: String) -> Result<Option<Inviter>, CoreError> {
        Ok(self
            .client()?
            .resolve_invite(&token)?
            .map(|inviter| Inviter {
                account_id: inviter.account_id,
                name: inviter.name,
                verified: inviter.verified,
            }))
    }

    /// This account's invite link as this device last made it.
    pub fn invite_link(&self) -> Result<Option<String>, CoreError> {
        Ok(self.client()?.invite_link()?)
    }

    /// A new invite link, which ends the one before.
    pub fn rotate_invite(&self) -> Result<String, CoreError> {
        Ok(self.client()?.rotate_invite()?)
    }

    pub fn revoke_invite(&self) -> Result<(), CoreError> {
        Ok(self.client()?.revoke_invite()?)
    }

    /// Revokes a device of this account. Revoking this one signs out: the
    /// store forgets everything.
    pub fn revoke_device(&self, device_id: String) -> Result<(), CoreError> {
        Ok(self.client()?.revoke_device(&device_id)?)
    }

    /// Deletes the account on the server, then everything in this store.
    pub fn delete_account(&self) -> Result<(), CoreError> {
        Ok(self.client()?.delete_account()?)
    }

    /// Uploads KeyPackages until the server holds `target`; returns how
    /// many it holds.
    pub fn stock_key_packages(&self, target: u32) -> Result<u32, CoreError> {
        Ok(self.client()?.stock_key_packages(target)?)
    }

    /// A new conversation with these accounts; it reaches the server on the
    /// next `sync`. Returns its id.
    pub fn create_conversation(&self, with: Vec<String>) -> Result<String, CoreError> {
        Ok(self.client()?.create_conversation(&with)?)
    }

    pub fn add_accounts(
        &self,
        conversation: String,
        accounts: Vec<String>,
    ) -> Result<(), CoreError> {
        Ok(self.client()?.add_accounts(&conversation, &accounts)?)
    }

    pub fn remove_accounts(
        &self,
        conversation: String,
        accounts: Vec<String>,
    ) -> Result<(), CoreError> {
        Ok(self.client()?.remove_accounts(&conversation, &accounts)?)
    }

    /// Queues a message; it is sent on the next `sync`. Returns the
    /// envelope id.
    pub fn send(&self, conversation: String, body: Body) -> Result<String, CoreError> {
        Ok(self.client()?.send(&conversation, body.into())?)
    }

    /// The `typing` frame for the app to send on the socket; none when
    /// typing is off, or an active one went less than 3 s ago.
    pub fn typing(&self, conversation: String, active: bool) -> Result<Option<String>, CoreError> {
        Ok(self.client()?.typing(&conversation, active)?)
    }

    /// Every conversation, newest activity first.
    pub fn conversations(&self) -> Result<Vec<Conversation>, CoreError> {
        Ok(self
            .client()?
            .conversations()?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Up to `limit` items before `before` (a seq), oldest first. The
    /// newest page ends with the pending and failed sends.
    pub fn timeline(
        &self,
        conversation: String,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<Item>, CoreError> {
        Ok(self
            .client()?
            .timeline(&conversation, before, limit)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Everything up to `seq` is read; call it when the newest item is on
    /// screen. Sends a receipt on the next `sync` when read markers are on.
    pub fn mark_read(&self, conversation: String, seq: u64) -> Result<(), CoreError> {
        Ok(self.client()?.mark_read(&conversation, seq)?)
    }

    /// Sends the failed items of a conversation again.
    pub fn retry(&self, conversation: String) -> Result<Outcome, CoreError> {
        Ok(self.client()?.retry(&conversation)?.into())
    }

    /// Every account met through a shared conversation, named ones first:
    /// the people picker.
    pub fn people(&self) -> Result<Vec<Person>, CoreError> {
        Ok(people(self.client()?.people()?))
    }

    /// An account's name and mark, fetched now; the stored one when there
    /// is no answer.
    pub fn profile(&self, account: String) -> Result<Person, CoreError> {
        Ok(self.client()?.profile(&account)?.into())
    }

    pub fn settings(&self) -> Result<Settings, CoreError> {
        let settings = self.client()?.settings()?;
        Ok(Settings {
            read_markers: settings.read_markers,
            typing: settings.typing,
        })
    }

    pub fn set_settings(&self, settings: Settings) -> Result<(), CoreError> {
        Ok(self.client()?.set_settings(core::Settings {
            read_markers: settings.read_markers,
            typing: settings.typing,
        })?)
    }

    /// The 1:1 with the invite's maker, made if there is none yet. Returns
    /// its id.
    pub fn open_invite(&self, token: String) -> Result<String, CoreError> {
        Ok(self.client()?.open_invite(&token)?)
    }

    /// Up to `limit` messages before `before` (a seq), newest last.
    pub fn history(
        &self,
        conversation: String,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<Message>, CoreError> {
        Ok(self
            .client()?
            .history(&conversation, before, limit)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// Sends what is queued and fetches what is new. Call it when the app
    /// starts, when the socket connects, and when the network comes back.
    pub fn sync(&self) -> Result<Outcome, CoreError> {
        Ok(self.client()?.sync()?.into())
    }

    /// One text frame from the socket.
    pub fn on_frame(&self, frame: String) -> Result<Outcome, CoreError> {
        Ok(self.client()?.on_frame(&frame)?.into())
    }
}

impl CoreClient {
    fn client(&self) -> Result<MutexGuard<'_, core::Client<Foreign>>, CoreError> {
        self.client.lock().map_err(|_| CoreError::Store {
            detail: "the client lock is poisoned".into(),
        })
    }
}
