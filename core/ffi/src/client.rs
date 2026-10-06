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
    /// This device missed what it needed to follow the group.
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

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Conversation {
    pub id: String,
    pub state: ConversationState,
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
            E::Removed { conversation } => Self::Removed { conversation },
            E::Stale { conversation } => Self::Stale { conversation },
            E::Typing {
                conversation,
                active,
            } => Self::Typing {
                conversation,
                active,
            },
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

    /// The `typing` frame for the app to send on the socket.
    pub fn typing(&self, conversation: String, active: bool) -> Result<String, CoreError> {
        Ok(self.client()?.typing(&conversation, active)?)
    }

    pub fn conversations(&self) -> Result<Vec<Conversation>, CoreError> {
        Ok(self
            .client()?
            .conversations()?
            .into_iter()
            .map(|c| Conversation {
                id: c.id,
                state: c.state.into(),
            })
            .collect())
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
