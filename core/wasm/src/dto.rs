//! The values the page gets: the shapes of `core/ffi/src/client.rs` for the
//! same calls, as plain data that `serde-wasm-bindgen` turns into objects.
//! Field names are camelCase; an enum is an object with a `kind`.
use serde::Serialize;
use spjall_client as core;
use spjall_client::api;
use spjall_envelope::Body;

mod event;
pub use event::Event;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub account: String,
    pub name: Option<String>,
    pub verified: bool,
    pub photo: Option<String>,
}

impl From<core::Person> for Person {
    fn from(person: core::Person) -> Self {
        let core::Person {
            account,
            name,
            verified,
            photo,
        } = person;

        Self {
            account,
            name,
            verified,
            photo,
        }
    }
}

fn people(list: Vec<core::Person>) -> Vec<Person> {
    list.into_iter().map(Into::into).collect()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    New,
    Active,
    Excluded,
    Removed,
    Left,
    Stale,
}

impl From<core::State> for State {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Mute {
    Off,
    Until { at: u64 },
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Sent,
    Pending,
    Failed,
}

impl From<core::Status> for Status {
    fn from(status: core::Status) -> Self {
        match status {
            core::Status::Sent => Self::Sent,
            core::Status::Pending => Self::Pending,
            core::Status::Failed => Self::Failed,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub envelope_id: String,
    pub sender: Option<Person>,
    pub text: Option<String>,
    pub post_id: Option<String>,
    pub location: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Content {
    Text {
        text: String,
        reply_to: Option<Quote>,
    },
    Media {
        mime: String,
        size: u64,
        caption: Option<String>,
        name: Option<String>,
    },
    Deleted,
    Members {
        added: Vec<Person>,
        removed: Vec<Person>,
        devices: Vec<Person>,
    },
    Timer {
        seconds: Option<u32>,
    },
    Name {
        name: Option<String>,
    },
    Photo {
        set: bool,
    },
    Post {
        post_id: String,
    },
    Location {
        lat_e6: i32,
        lon_e6: i32,
        accuracy: Option<u32>,
    },
    Unreadable {
        code: String,
    },
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
                        sender: sender.map(Into::into),
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reaction {
    pub emoji: String,
    pub own: bool,
    pub people: Vec<Person>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub seq: Option<u64>,
    pub envelope_id: Option<String>,
    pub sender: Person,
    pub own: bool,
    pub ts: u64,
    pub received_at: Option<u64>,
    pub status: Status,
    pub content: Content,
    pub edited: bool,
    pub reactions: Vec<Reaction>,
    pub read_by: u32,
    pub expires_at: Option<u64>,
    pub forwarded: bool,
}

impl From<core::Item> for Item {
    fn from(item: core::Item) -> Self {
        let core::Item {
            seq,
            envelope_id,
            sender,
            own,
            ts,
            received_at,
            status,
            content,
            edited,
            read_by,
            expires_at,
            forwarded,
            reactions,
        } = item;

        Self {
            seq,
            envelope_id,
            sender: sender.into(),
            own,
            ts,
            received_at,
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
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub state: State,
    pub name: Option<String>,
    pub photo: Option<String>,
    pub members: Vec<Person>,
    pub last: Option<Item>,
    pub unread: u32,
    pub timer: Option<u32>,
    pub mute: Mute,
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

/// A decrypted message of history, with its envelope's body as the envelope
/// crate writes it (`kind` tag).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub conversation: String,
    pub seq: u64,
    pub sender_account: String,
    pub sender_device: String,
    pub envelope: Envelope,
    pub own: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Envelope {
    pub id: String,
    pub ts: u64,
    pub body: Body,
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
                body: envelope.body,
            },
            own,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupDevice {
    pub account: String,
    pub device: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDevice {
    pub device_id: String,
    pub platform: api::Platform,
    /// `phone` or `web`.
    pub kind: &'static str,
    pub created_at: u64,
    pub current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Me {
    pub account_id: String,
    pub name: Option<String>,
    pub verified: bool,
    pub devices: Vec<AccountDevice>,
    pub photo: Option<String>,
}

impl From<api::Me> for Me {
    fn from(me: api::Me) -> Self {
        let api::Me {
            account_id,
            name,
            verified,
            photo,
            devices,
        } = me;

        Self {
            account_id,
            name,
            verified,
            devices: devices
                .into_iter()
                .map(
                    |api::AccountDevice {
                         device_id,
                         platform,
                         kind,
                         created_at,
                         current,
                     }| AccountDevice {
                        device_id,
                        platform,
                        kind: match kind {
                            api::DeviceKind::Phone => "phone",
                            api::DeviceKind::Web => "web",
                        },
                        created_at,
                        current,
                    },
                )
                .collect(),
            photo,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceLink {
    pub code: String,
    pub link_id: String,
    pub expires_at: i64,
}

impl From<core::DeviceLink> for DeviceLink {
    fn from(link: core::DeviceLink) -> Self {
        let core::DeviceLink {
            code,
            link_id,
            expires_at,
        } = link;

        Self {
            code,
            link_id,
            expires_at,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LinkState {
    Pending,
    Approved,
    Expired,
}

impl From<core::LinkState> for LinkState {
    fn from(state: core::LinkState) -> Self {
        match state {
            core::LinkState::Pending => Self::Pending,
            core::LinkState::Approved => Self::Approved,
            core::LinkState::Expired => Self::Expired,
        }
    }
}

/// `completeLink`'s answer, except the key share, which the page gets as a
/// `Uint8Array` beside this.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Enrolled {
    pub account_id: String,
    pub device_id: String,
    pub history_expected: bool,
}
