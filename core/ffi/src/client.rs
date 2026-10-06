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
}

/// A request to the API. `path` starts at `/v1/` and holds any query. The
/// transport adds the base URL, `Authorization: Bearer <device token>`, and
/// `content-type: application/json` when there is a body.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub path: String,
    pub body: Option<String>,
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
            },
            path: request.path,
            body: request.body,
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
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ConversationState {
    /// Made here; the server does not have it yet.
    New,
    Active,
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

    /// Records the ids registerDevice answered with.
    pub fn registered(&self, account_id: String, device_id: String) -> Result<(), CoreError> {
        Ok(self.client()?.registered(&account_id, &device_id)?)
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
