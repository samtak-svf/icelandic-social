//! The client of decision 0018 as the apps see it. The app implements
//! `Transport` over OkHttp or URLSession, owns the WebSocket, and calls
//! `CoreClient` off the main thread: every call may block on the network.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use spjall_client::{self as core, ClientError, HistoryError, LinkError, MediaError, api};

use crate::foreign::{Foreign, path_string};
use crate::frames::{Frame, Framing};
use crate::{Body, CoreError, Envelope, store_code};
pub mod event;
mod me;
pub mod notices;
pub use event::Event;
pub use me::{AccountDevice, AccountSuspension, Me};
pub use notices::{Notice, NoticeKind, Notices, SocialNotice};
pub use spjall_client::LinkRequest;
pub use spjall_client::Person;
pub use spjall_client::api::DeviceKind;
pub use spjall_client::api::Platform;

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum HttpMethod {
    Get,
    Post,
    Delete,
    Put,
    Patch,
}

/// A request to the API. `path` starts at `/v1/` and holds any query. The
/// transport adds the base URL, `Authorization: Bearer <bearer>` when there
/// is a bearer, `Spjall-Client: <client>` when there is a client (0030), and
/// `content-type: application/json` when there is a body. The bearer is the
/// device token: the transport never logs it.
#[derive(Clone, PartialEq, Eq, uniffi::Record)]
pub struct HttpRequest {
    pub method: HttpMethod,
    pub path: String,
    pub body: Option<String>,
    pub bearer: Option<String>,
    pub client: Option<String>,
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

/// What the app provides: one blocking HTTP request, and the two that carry
/// a file (0023). Files go by path; their bytes never cross this boundary.
#[uniffi::export(with_foreign)]
pub trait Transport: Send + Sync {
    fn request(&self, request: HttpRequest) -> Result<HttpResponse, TransportError>;

    /// A `PUT` whose body is the file at `path`, streamed, as
    /// `application/octet-stream`.
    fn upload(&self, request: HttpRequest, path: String) -> Result<HttpResponse, TransportError>;

    /// A `GET` whose 200 body is streamed into the file at `to`; any other
    /// status comes back with its body as text, and `to` is left alone.
    fn download(&self, request: HttpRequest, to: String) -> Result<HttpResponse, TransportError>;
}

/// The code of an MLS failure (0049): which refusal it is, and the step for
/// one OpenMLS gave. Never OpenMLS's own text.
fn mls_code(error: &spjall_mls::group::GroupError) -> String {
    use spjall_mls::group::GroupError;
    use spjall_mls::storage::StorageError;
    match error {
        GroupError::Storage(StorageError::Store(error)) => format!("storage/{}", store_code(error)),
        GroupError::Storage(StorageError::Serialization(_)) => "storage/serialization".into(),
        GroupError::Storage(StorageError::Missing) => "storage/missing".into(),
        GroupError::Missing(what) => format!("missing/{what}"),
        GroupError::Malformed(what) => format!("malformed/{what}"),
        GroupError::Credential => "credential".into(),
        GroupError::NotTheClaimedDevice => "not-the-claimed-device".into(),
        GroupError::AlreadyMember => "already-member".into(),
        GroupError::CommitInFlight => "commit-in-flight".into(),
        GroupError::OwnAccount => "own-account".into(),
        GroupError::OwnDevice => "own-device".into(),
        GroupError::Expired => "expired".into(),
        GroupError::Epoch { .. } => "epoch".into(),
        GroupError::Mls { step, .. } => format!("openmls/{step}"),
    }
}

impl From<ClientError> for CoreError {
    fn from(error: ClientError) -> Self {
        match error {
            ClientError::Store(error) => error.into(),
            ClientError::Mls(error) => Self::Mls {
                detail: mls_code(&error),
            },
            ClientError::Transport(api::ApiError::Unreachable(api::Unreachable(detail))) => {
                Self::Unreachable { detail }
            }
            ClientError::Transport(api::ApiError::Refused {
                status,
                code,
                request_id,
            }) => Self::Refused {
                status,
                code,
                request_id,
            },
            ClientError::Transport(api::ApiError::ClientTooOld { min, update_url }) => {
                Self::ClientTooOld {
                    min_version: min,
                    update_url,
                }
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
            ClientError::Media(MediaError::TooLarge) => Self::TooLarge,
            ClientError::Media(MediaError::Tampered) => Self::Tampered,
            ClientError::Media(MediaError::File(error)) => Self::File {
                detail: format!("{:?}", error.kind()),
            },
            ClientError::History(HistoryError::TooLarge) => Self::TooLarge,
            ClientError::History(HistoryError::Tampered) => Self::Tampered,
            ClientError::History(HistoryError::File(error)) => Self::File {
                detail: format!("{:?}", error.kind()),
            },
            ClientError::CannotForward(reason) => Self::CannotForward { reason },
            // NotApproved is only raised by a browser completing its own link;
            // the apps never call that, so it shares the code's error.
            ClientError::Link(LinkError::InvalidCode | LinkError::NotApproved) => {
                Self::LinkCodeInvalid
            }
            ClientError::NameInvalid => Self::NameInvalid,
            ClientError::NotAGroup => Self::NotAGroup,
            ClientError::GroupPhoto(_) => Self::UnsupportedImage,
            ClientError::NoMaster => Self::NoMaster,
            ClientError::Link(LinkError::KeyMismatch) => Self::LinkKeyMismatch,
            ClientError::Link(LinkError::Gone) => Self::LinkExpired,
            ClientError::Link(LinkError::AlreadyApproved) => Self::LinkAlreadyApproved,
        }
    }
}

/// Which app is signing in; registerDevice records it.
#[uniffi::remote(Enum)]
pub enum Platform {
    Android,
    Ios,
}

/// Who a person signs in with (0033): Google first, Kenni for the mark.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SignInProvider {
    Google,
    Kenni,
}

impl From<SignInProvider> for api::Provider {
    fn from(provider: SignInProvider) -> Self {
        match provider {
            SignInProvider::Google => Self::Google,
            SignInProvider::Kenni => Self::Kenni,
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
        let core::SignedIn { account, device } = device;

        Self {
            account_id: account,
            device_id: device,
        }
    }
}

/// What kind of device an account holds (0064): a phone, or a browser
/// linked from its session.
#[uniffi::remote(Enum)]
pub enum DeviceKind {
    Phone,
    Web,
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
/// A one-time key pair for receiving a history (0064): the public half
/// goes in the link QR, the private half never leaves the new device.
#[derive(Clone, PartialEq, Eq, uniffi::Record)]
pub struct HistoryKey {
    pub private: Vec<u8>,
    pub public: Vec<u8>,
}

/// The private half stays out of logs.
impl std::fmt::Debug for HistoryKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HistoryKey").finish_non_exhaustive()
    }
}

#[uniffi::export]
pub fn history_key() -> Result<HistoryKey, CoreError> {
    let key = core::history_key().map_err(ClientError::from)?;
    Ok(HistoryKey {
        private: key.private,
        public: key.public,
    })
}

/// What an import added.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ImportedHistory {
    pub conversations: u32,
    pub items: u32,
    pub files: u32,
}

impl From<core::Imported> for ImportedHistory {
    fn from(imported: core::Imported) -> Self {
        let core::Imported {
            conversations,
            items,
            files,
        } = imported;

        Self {
            conversations,
            items,
            files,
        }
    }
}

/// Whether `text`, read off a QR code, is a link code a browser shows
/// (0077), so a scanner can stop at the first one.
#[uniffi::export]
pub fn is_link_code(text: String) -> bool {
    core::LinkCode::parse(&text).is_some()
}

/// A browser's pending request to be linked to this account (0064), as the
/// phone shows it before approving: `browser` and `os` as the server read
/// them, and when it expires, in milliseconds.
#[uniffi::remote(Record)]
pub struct LinkRequest {
    pub browser: Option<String>,
    pub os: Option<String>,
    pub expires_at: i64,
    pub approved: bool,
}

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
    /// This account left (0078); a commit that adds it again makes it
    /// `Active`.
    Left,
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
            core::State::Left => Self::Left,
            core::State::Stale => Self::Stale,
        }
    }
}

/// An account as the screens show it: the name and mark the server gave,
/// none until the core has fetched them.
#[uniffi::remote(Record)]
pub struct Person {
    pub account: String,
    pub name: Option<String>,
    pub verified: bool,
    /// The version of its photo (0039), for `photo`; none when it has none,
    /// a block stands between the two, or the core has not fetched it.
    #[uniffi(default = None)]
    pub photo: Option<String>,
}

/// A page of the directory (0036), verified first, then by name.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PersonPage {
    pub people: Vec<Person>,
    /// The `after` of the next page, none on the last.
    pub next: Option<String>,
}

impl From<core::Directory> for PersonPage {
    fn from(page: core::Directory) -> Self {
        let core::Directory {
            people: listed,
            next,
        } = page;

        Self {
            people: people(listed),
            next,
        }
    }
}

/// What the conversation list's search found (0038): the conversations,
/// then the people from the directory with no 1:1 among them.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ListSearch {
    pub conversations: Vec<Conversation>,
    pub people: Vec<Person>,
}

impl From<core::ListSearch> for ListSearch {
    fn from(found: core::ListSearch) -> Self {
        let core::ListSearch {
            conversations,
            people: listed,
        } = found;

        Self {
            conversations: conversations.into_iter().map(Into::into).collect(),
            people: people(listed),
        }
    }
}

pub(crate) fn people(people: Vec<core::Person>) -> Vec<Person> {
    people.into_iter().collect()
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Conversation {
    pub id: String,
    pub state: ConversationState,
    /// The group's name (0078); none for a conversation of two, and for a
    /// group whose name was never set or was cleared. The title is then
    /// the members' names.
    #[uniffi(default = None)]
    pub name: Option<String>,
    /// The path of the group photo, a JPEG this core wrote and opened; none
    /// when the group has none or it is yet to be fetched (0094).
    #[uniffi(default = None)]
    pub photo: Option<String>,
    /// Everyone here but this account, named ones first.
    pub members: Vec<Person>,
    /// The newest item, if any.
    pub last: Option<Item>,
    pub unread: u32,
    /// The disappearing timer, in seconds.
    pub timer: Option<u32>,
    /// Whether this account muted it (0042); `unread` still counts.
    pub mute: Mute,
}

/// Whether a conversation is muted, and until when (0042).
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum Mute {
    Off,
    /// Until `at`, in Unix milliseconds by the server's clock.
    Until {
        at: u64,
    },
    /// Until turned back on.
    Always,
}

impl From<core::Mute> for Mute {
    fn from(mute: core::Mute) -> Self {
        match mute {
            core::Mute::Off => Self::Off,
            core::Mute::Until(at) => Self::Until { at },
            core::Mute::Always => Self::Always,
        }
    }
}

/// How long a mute lasts, from when the server takes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum MuteFor {
    Hour,
    EightHours,
    Always,
}

impl From<MuteFor> for core::MuteFor {
    fn from(duration: MuteFor) -> Self {
        match duration {
            MuteFor::Hour => Self::Hour,
            MuteFor::EightHours => Self::EightHours,
            MuteFor::Always => Self::Always,
        }
    }
}

impl From<core::Conversation> for Conversation {
    fn from(conversation: core::Conversation) -> Self {
        let core::Conversation {
            id,
            state,
            name,
            members,
            last,
            unread,
            timer,
            mute,
            photo,
        } = conversation;

        Self {
            id,
            state: state.into(),
            name,
            photo: photo.map(|path| path.to_string_lossy().into_owned()),
            members: people(members),
            last: last.map(Into::into),
            unread,
            timer,
            mute: mute.into(),
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
    /// The post, when the reply answers a shared post (0040); `text` is
    /// then none, and the app draws the quote as the fixed line of 0044.
    #[uniffi(default = None)]
    pub post_id: Option<String>,
    /// The reply answers a location (0059); `text` is then none, and the
    /// app draws the quote as "Staðsetning", never the place.
    #[uniffi(default = false)]
    pub location: bool,
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
        /// The sender's name for the file, safe to name a copy with.
        name: Option<String>,
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
    /// The group was named, or its name cleared (0078).
    Name { name: Option<String> },
    /// The group photo was set (`set`) or removed (0094); the picture itself
    /// is `Conversation.photo`.
    Photo { set: bool },
    /// A post shared here under 0040: only its id. Since 0080 the app
    /// resolves it as a card through `cards` (#288), which shows only what
    /// the post's own access check shows; the list's last line and a notice
    /// show a fixed sentence.
    Post { post_id: String },
    /// A place sent once (0059). The card draws it from `place_links`, and
    /// the list's last line and a notice show a fixed sentence.
    Location {
        lat_e6: i32,
        lon_e6: i32,
        accuracy: Option<u32>,
    },
    /// A stored row the core cannot decode (0051): the app shows a fixed
    /// sentence and this code, which never holds the row's content.
    Unreadable { code: String },
}

impl From<core::Content> for Content {
    fn from(content: core::Content) -> Self {
        use core::Content as C;
        match content {
            C::Text { text, reply_to } => Self::Text {
                text,
                reply_to: reply_to.map(
                    |core::Quote {
                         envelope_id,
                         sender,
                         text,
                         post_id,
                         location,
                     }| Quote {
                        envelope_id,
                        sender,
                        text,
                        post_id,
                        location,
                    },
                ),
            },
            C::Media {
                mime,
                size,
                caption,
                name,
            } => Self::Media {
                mime,
                size,
                caption,
                name,
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
            C::Name { name } => Self::Name { name },
            C::Photo { set } => Self::Photo { set },
            C::Post { post_id } => Self::Post { post_id },
            C::Location {
                lat_e6,
                lon_e6,
                accuracy,
            } => Self::Location {
                lat_e6,
                lon_e6,
                accuracy,
            },
            C::Unreadable { code } => Self::Unreadable { code },
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
    /// A copy of a message from another conversation, shown with its mark
    /// (0041). `sender` is who forwarded it; the author is not known.
    pub forwarded: bool,
    /// When the server stored it, in milliseconds by its clock, never
    /// earlier than the item before (0048). None while it is being sent,
    /// and for rows stored before the server gave it.
    #[uniffi(default = None)]
    pub received_at: Option<u64>,
}

impl From<core::Item> for Item {
    fn from(item: core::Item) -> Self {
        let core::Item {
            seq,
            envelope_id,
            sender,
            own,
            ts,
            status,
            content,
            edited,
            read_by,
            expires_at,
            forwarded,
            received_at,
            reactions,
        } = item;

        Self {
            seq,
            envelope_id,
            sender,
            own,
            ts,
            status: status.into(),
            content: content.into(),
            edited,
            reactions: reactions
                .into_iter()
                .map(
                    |core::Reaction {
                         emoji,
                         own,
                         people: reacted,
                     }| Reaction {
                        emoji,
                        own,
                        people: people(reacted),
                    },
                )
                .collect(),
            read_by,
            expires_at,
            forwarded,
            received_at,
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
        let core::Message {
            conversation,
            seq,
            sender,
            envelope,
            own,
        } = message;

        Self {
            conversation,
            seq,
            sender_account: sender.account,
            sender_device: sender.device,
            envelope: Envelope {
                id: envelope.id,
                ts: envelope.ts,
                body: envelope.body.into(),
            },
            own,
        }
    }
}

/// A device in a conversation's group.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GroupDevice {
    pub account: String,
    pub device: String,
}

/// What a call produced: events to show, and frames to send on the socket.
#[derive(Debug, Clone, Default, PartialEq, Eq, uniffi::Record)]
pub struct Outcome {
    pub events: Vec<Event>,
    pub frames: Vec<String>,
}

impl From<core::Outcome> for Outcome {
    fn from(outcome: core::Outcome) -> Self {
        let core::Outcome { events, frames } = outcome;

        Self {
            events: events.into_iter().map(Into::into).collect(),
            frames,
        }
    }
}

/// This device's client: one per process, over the store in `dir`. A call
/// that reads the store goes through `view` (0056), one that only asks the
/// server through `hosted` (0113); `client` is for what writes.
#[derive(uniffi::Object)]
pub struct CoreClient {
    client: Mutex<core::Client<Foreign>>,
    /// The server-only calls (0113): the transport and a share of the device
    /// token, so a profile or a notification list is fetched while a sync
    /// holds `client` through its requests. No method that moved here may
    /// call `client()`.
    pub(crate) hosted: core::Hosted<Foreign>,
    /// The reads (0056), on a connection and a lock of their own, so a
    /// sync holding `client` through its requests never delays them.
    view: Mutex<core::View>,
    /// The `Spjall-Client` value, fixed at `open`, so reading it takes no
    /// lock at all.
    header: String,
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
        platform: Platform,
        version: String,
    ) -> Result<Arc<Self>, CoreError> {
        let key: spjall_store::Key = key.try_into().map_err(|key: Vec<u8>| CoreError::Store {
            detail: format!("key-length/{}", key.len()),
        })?;
        let mut client = core::Client::open(Path::new(&dir), &key, Foreign(transport))?;
        client.set_client_version(platform, &version)?;
        let view = client.view()?;
        let hosted = client.hosted();
        let header = client.client_header().unwrap_or_default().to_owned();
        Ok(Arc::new(Self {
            client: Mutex::new(client),
            hosted,
            view: Mutex::new(view),
            header,
        }))
    }

    /// The `Spjall-Client` value every request carries (0030), for the
    /// app to set on the WebSocket upgrade too.
    pub fn client_header(&self) -> Result<String, CoreError> {
        Ok(self.header.clone())
    }

    /// This device's Ed25519 public key, made on first call: the
    /// `deviceKey` that registerDevice takes.
    pub fn device_key(&self) -> Result<Vec<u8>, CoreError> {
        Ok(self.client()?.device_key()?)
    }

    /// Starts a sign-in with `provider` and returns the URL to open in
    /// Custom Tabs or `ASWebAuthenticationSession`. The sign-in waits in the
    /// store, so it survives the process ending while the browser is open;
    /// a new one replaces it. Kenni comes back at `is.samtak.spjall:/kenni`,
    /// Google at `is.samtak.spjall:/google`.
    pub fn begin_sign_in(&self, provider: SignInProvider) -> Result<String, CoreError> {
        Ok(self.client()?.begin_sign_in(provider.into())?)
    }

    /// Finishes the sign-in with the URL the provider redirected to, and
    /// the invite token that brought the person, if one did. `Unreachable`
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
            .complete_sign_in(&callback, invite_token.as_deref(), platform)?
            .into())
    }

    /// Starts linking `provider` to this account (0033): Kenni's adds the
    /// mark and the registry's name. The URL is opened as a sign-in's is,
    /// and the callback, which a signed-in app gets only from a link, goes
    /// to `complete_link`.
    pub fn begin_link(&self, provider: SignInProvider) -> Result<String, CoreError> {
        Ok(self.client()?.begin_link(provider.into())?)
    }

    /// Finishes a link with the URL the provider redirected to; `me` then
    /// shows the mark. Another account holding the identity is `Refused`
    /// with 409 `identity_taken`. True when Kenni joined this account into
    /// the older one holding the kennitala (0035): this device now belongs
    /// to it, its conversations are gone, and the app starts its signed-in
    /// session again. It ends as `complete_sign_in` does.
    pub fn complete_link(&self, callback: String) -> Result<bool, CoreError> {
        Ok(self.client()?.complete_link(&callback)?.moved)
    }

    /// Seals this device's history since `since` (ms; none for all of it)
    /// to a linked device's one-time public key, into the file at `to`
    /// (0064). Media go newest first while the whole stays under 1 GiB;
    /// the rest travel as references. Returns the file's size; over the
    /// cap with the messages alone is `TooLarge`.
    pub fn export_history(
        &self,
        since: Option<u64>,
        recipient: Vec<u8>,
        to: String,
    ) -> Result<u64, CoreError> {
        Ok(self
            .client()?
            .export_history(since, &recipient, Path::new(&to))?)
    }

    /// Opens a history sealed to `private` and adds it to this store: the
    /// conversations show their messages before this device joins them.
    /// All or nothing; a file that is not whole is `Tampered`, and the
    /// same file twice adds nothing the second time.
    pub fn import_history(
        &self,
        from: String,
        private: Vec<u8>,
    ) -> Result<ImportedHistory, CoreError> {
        Ok(self
            .client()?
            .import_history(Path::new(&from), &private)?
            .into())
    }

    /// Seals this device's history since `since` to `recipient` and
    /// uploads it for the device the link `link` makes (0074). Only the
    /// phone that approved the link may, once. Returns the sealed size.
    pub fn send_history(
        &self,
        link: String,
        since: Option<u64>,
        recipient: Vec<u8>,
    ) -> Result<u64, CoreError> {
        Ok(self.client()?.send_history(&link, since, &recipient)?)
    }

    /// The pending link request the code `code` names, once its keys are
    /// checked against the code's (0077).
    pub fn inspect_link(&self, code: String) -> Result<LinkRequest, CoreError> {
        Ok(self.client()?.inspect_link(&code)?)
    }

    /// Approves the link request the code `code` names with this phone's
    /// signature (0077), then, when `send` is set, sends this device's
    /// history since `since` to the new device. Returns the sealed size,
    /// or 0 when nothing was sent.
    pub fn approve_link(
        &self,
        code: String,
        since: Option<u64>,
        send: bool,
    ) -> Result<u64, CoreError> {
        Ok(self.client()?.approve_link(&code, since, send)?)
    }

    /// Downloads the history sent for the link that made this device,
    /// adds it to this store, and deletes it from the server (0074). A
    /// history that does not open stays there for another try.
    pub fn receive_history(
        &self,
        link: String,
        private: Vec<u8>,
    ) -> Result<ImportedHistory, CoreError> {
        Ok(self.client()?.receive_history(&link, &private)?.into())
    }

    /// The account and device this store is signed in as, if it is. Read
    /// from the store, so a sync in progress does not hold up a start.
    pub fn signed_in(&self) -> Result<Option<SignedIn>, CoreError> {
        Ok(self.view().signed_in()?.map(Into::into))
    }

    /// The device token, for the WebSocket upgrade's `Authorization`; read
    /// from the store, as `signed_in` is.
    pub fn device_token(&self) -> Result<Option<String>, CoreError> {
        Ok(self.view().device_token()?)
    }

    pub fn me(&self) -> Result<Me, CoreError> {
        Ok(self.hosted.me()?.into())
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
        Ok(self.view().invite_link()?)
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

    /// Names a group, or clears its name with none (0078); queued like a
    /// message, and returns its envelope id. `NotAGroup` for a
    /// conversation of two, `NameInvalid` past 64 characters or with a
    /// control character.
    pub fn rename(&self, conversation: String, name: Option<String>) -> Result<String, CoreError> {
        Ok(self.client()?.rename(&conversation, name)?)
    }

    /// Sets the group photo from a JPEG, PNG or WebP file (0094): the core
    /// crops it to a square, shrinks it, strips its metadata and sends it
    /// sealed to the members; queued like a message, returns its envelope
    /// id. `NotAGroup` for a conversation of two, `UnsupportedImage` for a
    /// file it cannot read.
    pub fn set_group_photo(&self, conversation: String, path: String) -> Result<String, CoreError> {
        Ok(self
            .client()?
            .set_group_photo(&conversation, Path::new(&path))?)
    }

    /// Removes the group photo (0094); queued like a message.
    pub fn clear_group_photo(&self, conversation: String) -> Result<String, CoreError> {
        Ok(self.client()?.clear_group_photo(&conversation)?)
    }

    /// Leaves a group (0078): the server stops listing this account, the
    /// others remove it on their next sync, and here it is `Left`. Done
    /// once is done.
    pub fn leave(&self, conversation: String) -> Result<(), CoreError> {
        Ok(self.client()?.leave(&conversation)?)
    }

    /// Queues a message; it is sent on the next `sync`. Returns the
    /// envelope id. A `Post` shares a community post by its id (0080, which
    /// amends 0044); the receiver resolves it as a card through `cards`
    /// (#288), so it shows only what the post's own access check shows. A
    /// malformed id is `Invalid`.
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
            .view()
            .conversations()?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// The conversations with someone whose name matches `query` at the
    /// start of a word, compared without case or the Icelandic letters
    /// (0038), newest activity first. Searched on this device alone; a
    /// blank query keeps every conversation.
    pub fn search_conversations(&self, query: String) -> Result<Vec<Conversation>, CoreError> {
        Ok(self
            .view()
            .search_conversations(&query)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// The conversation list's search (0038): the conversations matching
    /// `query`, then up to `limit` people from the directory, leaving out
    /// anyone whose 1:1 is already among those conversations so no one
    /// shows twice. A blank query asks the directory nothing.
    pub fn search_list(&self, query: String, limit: u32) -> Result<ListSearch, CoreError> {
        let conversations = self.view().search_conversations(&query)?;
        if core::blank(&query)? {
            return Ok(core::ListSearch {
                conversations,
                people: Vec::new(),
            }
            .into());
        }
        Ok(self
            .client()?
            .with_people(&query, limit, conversations)?
            .into())
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
            .view()
            .timeline(&conversation, before, limit)?
            .into_iter()
            .map(Into::into)
            .collect())
    }

    /// The photos and files of a conversation (0055), up to `limit` before
    /// `before` (a seq), newest first, from this device's store alone.
    pub fn shared(
        &self,
        conversation: String,
        before: Option<u64>,
        limit: u32,
    ) -> Result<Vec<Item>, CoreError> {
        Ok(self
            .view()
            .shared(&conversation, before, limit)?
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
        Ok(people(self.view().people()?))
    }

    /// A page of everyone else signed in (0036), for the people picker:
    /// verified first, then by name. `query` keeps the names that contain
    /// it, compared without case or the Icelandic letters; `after` is the
    /// `next` of the page before. At most 50 a page.
    pub fn directory(
        &self,
        query: Option<String>,
        after: Option<String>,
        limit: u32,
    ) -> Result<PersonPage, CoreError> {
        Ok(self
            .client()?
            .directory(query.as_deref(), after.as_deref(), limit)?
            .into())
    }

    /// An account's name and mark, fetched now; the stored one when there
    /// is no answer.
    pub fn profile(&self, account: String) -> Result<Person, CoreError> {
        Ok(self.client()?.profile(&account)?)
    }

    /// Sets this account's photo from the image at `path` (0039), in place
    /// of any it had: at most 10 MB. The server re-encodes it to a 512 px
    /// WebP without the image's metadata and keeps only that. Returns the
    /// new version, which `photo` fetches like anyone else's.
    pub fn set_photo(&self, path: String) -> Result<String, CoreError> {
        Ok(self.client()?.set_photo(Path::new(&path))?)
    }

    /// Frames this account's photo again (0086): the server cuts it from the
    /// master it kept, so there is no new upload. Returns the new version,
    /// which `photo_framed` fetches. `NoMaster` for a photo set before
    /// masters were kept, which the person uploads once more; `Invalid` for
    /// a framing the server would refuse (a fraction outside 0 to 1).
    pub fn set_photo_framing(&self, framing: Framing) -> Result<String, CoreError> {
        Ok(self.client()?.set_photo_framing(&framing.into())?)
    }

    /// How this account's photo is framed, asked of the server now; none
    /// without a photo or for one set before frames. The editor opens there.
    pub fn photo_framing(&self) -> Result<Option<Framing>, CoreError> {
        Ok(self.client()?.photo_framing()?.map(Into::into))
    }

    /// Writes the master of this account's photo (a WebP, at most 2400 px
    /// on its long edge) to `path`, for the editor to frame again. False
    /// when there is none: no photo, or one set before masters were kept.
    pub fn photo_source(&self, path: String) -> Result<bool, CoreError> {
        Ok(self.client()?.photo_source(Path::new(&path))?)
    }

    /// `photo` for one frame (0086): the path of `account`'s photo at
    /// `version` in `frame`, `Square` for a photo. Kept per frame, each with
    /// only its latest version. None as for `photo`.
    pub fn photo_framed(
        &self,
        account: String,
        version: String,
        frame: Frame,
    ) -> Result<Option<String>, CoreError> {
        Ok(self
            .client()?
            .photo_framed(&account, &version, frame)?
            .as_deref()
            .map(path_string))
    }

    /// Removes this account's photo.
    pub fn remove_photo(&self) -> Result<(), CoreError> {
        Ok(self.client()?.remove_photo()?)
    }

    /// The path of `account`'s photo at `version`, the `photo` of its
    /// `Person`, post author or `Me`: fetched once per version and kept by
    /// the core. None when the server has none for this account, as across
    /// a block; draw the initials then, and while this runs.
    pub fn photo(&self, account: String, version: String) -> Result<Option<String>, CoreError> {
        Ok(self
            .client()?
            .photo(&account, &version)?
            .as_deref()
            .map(path_string))
    }

    pub fn settings(&self) -> Result<Settings, CoreError> {
        let settings = self.view().settings()?;
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

    /// The 1:1 with any signed-in account (0034, 0036), no link needed: the
    /// one this account already has with it alone, or a new one that adds
    /// it on the next `sync`. `Invalid` for this account itself or one it
    /// blocked.
    pub fn open_direct(&self, account: String) -> Result<String, CoreError> {
        Ok(self.client()?.open_direct(&account)?)
    }

    /// Seals the file at `path` with a new key, uploads it and sends it as
    /// one message (0023). The app keeps nothing: the core copies the file
    /// into its own folder first. Returns the envelope id.
    pub fn send_media(
        &self,
        conversation: String,
        path: String,
        mime: String,
        caption: Option<String>,
        name: Option<String>,
    ) -> Result<String, CoreError> {
        Ok(self
            .client()?
            .send_media(&conversation, Path::new(&path), &mime, caption, name)?)
    }

    /// Copies the text or file at `seq` of `from` into `to` as a new
    /// message from this account, marked forwarded, and queues it (0041). A
    /// file is downloaded if needed and uploaded again under a new key.
    /// Refused with `CannotForward` for a message under a disappearing
    /// timer, a deleted one, or anything else that is not a message. Returns
    /// the new envelope id.
    pub fn forward(&self, from: String, seq: u64, to: String) -> Result<String, CoreError> {
        Ok(self.client()?.forward(&from, seq, &to)?)
    }

    /// The path of the media item at `seq`, downloaded, checked and opened
    /// the first time it is asked for. The file is the core's: it goes when
    /// the item disappears or the account is forgotten.
    pub fn media(&self, conversation: String, seq: u64) -> Result<String, CoreError> {
        Ok(path_string(&self.client()?.media(&conversation, seq)?))
    }

    /// Deletes what has disappeared; call it when the next `expires_at` of
    /// an item on screen passes. Gives `Expired` events.
    pub fn expire(&self) -> Result<Outcome, CoreError> {
        Ok(self.client()?.expire()?.into())
    }

    /// Blocks an account (0024): the server refuses it new contact, and the
    /// 1:1s with it end. Its messages in shared groups are hidden.
    pub fn block(&self, account: String) -> Result<Outcome, CoreError> {
        Ok(self.client()?.block(&account)?.into())
    }

    pub fn unblock(&self, account: String) -> Result<(), CoreError> {
        Ok(self.client()?.unblock(&account)?)
    }

    /// Mutes a conversation on every device of this account (0042): no
    /// push for it until the mute ends, and `notices()` shows none.
    pub fn mute(&self, conversation: String, duration: MuteFor) -> Result<Mute, CoreError> {
        Ok(self.client()?.mute(&conversation, duration.into())?.into())
    }

    /// Turns notifications back on for a conversation.
    pub fn unmute(&self, conversation: String) -> Result<(), CoreError> {
        Ok(self.client()?.unmute(&conversation)?)
    }

    /// Keeps this device's push token; the next `sync` sends it. `sandbox`
    /// is an APNs development token. True while the server lacks it: only
    /// then is a `sync` due.
    pub fn set_push_token(&self, token: String, sandbox: bool) -> Result<bool, CoreError> {
        Ok(self.client()?.set_push_token(&token, sandbox)?)
    }

    /// After a push and a `sync`: the new messages to show, once each, and
    /// the conversations whose notifications to take away.
    pub fn notices(&self) -> Result<Notices, CoreError> {
        Ok(self.client()?.notices()?.into())
    }

    /// The accounts this one blocked, newest first.
    pub fn blocked(&self) -> Result<Vec<Person>, CoreError> {
        Ok(people(self.client()?.blocked()?))
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
    /// `NotRegistered` means the server no longer answers this device's
    /// token: the store has forgotten everything and the app signs in again
    /// (0057).
    pub fn sync(&self) -> Result<Outcome, CoreError> {
        Ok(self.client()?.sync()?.into())
    }

    /// `sync` for one conversation alone: sends its queue and fetches what
    /// is new there, with no request for any other (0099). The apps call it
    /// after a send. Signs out as `sync` does.
    pub fn sync_conversation(&self, conversation: String) -> Result<Outcome, CoreError> {
        Ok(self.client()?.sync_conversation(&conversation)?.into())
    }

    /// One text frame from the socket. Signs out as `sync` does.
    pub fn on_frame(&self, frame: String) -> Result<Outcome, CoreError> {
        Ok(self.client()?.on_frame(&frame)?.into())
    }
}

impl CoreClient {
    /// A call that panicked left the client as a failed call does: the
    /// store's transaction rolled back as it unwound, and `outcome` keeps
    /// what it had gathered. So the lock is taken again rather than refusing
    /// every later call until the app restarts.
    pub(crate) fn client(&self) -> Result<MutexGuard<'_, core::Client<Foreign>>, CoreError> {
        Ok(self.client.lock().unwrap_or_else(PoisonError::into_inner))
    }

    /// The reads' lock, taken again after a panic as `client` is: a read
    /// changes nothing, so there is nothing for it to leave half done.
    fn view(&self) -> MutexGuard<'_, core::View> {
        self.view.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod device_kind_tests {
    use super::*;

    fn me(devices: &str) -> Me {
        let json = format!(
            r#"{{"accountId":"a","name":null,"verified":false,"photo":null,"devices":{devices}}}"#
        );
        serde_json::from_str::<api::Me>(&json).unwrap().into()
    }

    /// A browser linked from a session reads as `Web`; a server older than
    /// 0064 names no kind, and the device is a phone (#155).
    #[test]
    fn a_device_carries_its_kind() {
        let found = me(r#"[
            {"deviceId":"w1","platform":"android","kind":"web","createdAt":2,"current":true},
            {"deviceId":"a1","platform":"android","createdAt":1,"current":false}
        ]"#);
        let kinds: Vec<_> = found.devices.iter().map(|d| d.kind).collect();
        assert_eq!(kinds, [DeviceKind::Web, DeviceKind::Phone]);
    }
}
