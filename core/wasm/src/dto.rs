//! The values the page gets: the shapes of `core/ffi/src/client.rs` for the
//! same calls, as plain data that `serde-wasm-bindgen` turns into objects.
//! Field names are camelCase; an enum is an object with a `kind`.
use serde::Serialize;
use spjall_client as core;
use spjall_client::api;
use spjall_envelope::Body;

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
        Self {
            account: person.account,
            name: person.name,
            verified: person.verified,
            photo: person.photo,
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
                reply_to: reply_to.map(|quote| Quote {
                    envelope_id: quote.envelope_id,
                    sender: quote.sender.map(Into::into),
                    text: quote.text,
                    post_id: quote.post_id,
                    location: quote.location,
                }),
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
        Self {
            seq: item.seq,
            envelope_id: item.envelope_id,
            sender: item.sender.into(),
            own: item.own,
            ts: item.ts,
            received_at: item.received_at,
            status: item.status.into(),
            content: item.content.into(),
            edited: item.edited,
            reactions: item
                .reactions
                .into_iter()
                .map(|reaction| Reaction {
                    emoji: reaction.emoji,
                    own: reaction.own,
                    people: people(reaction.people),
                })
                .collect(),
            read_by: item.read_by,
            expires_at: item.expires_at,
            forwarded: item.forwarded,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    pub id: String,
    pub state: State,
    pub name: Option<String>,
    pub members: Vec<Person>,
    pub last: Option<Item>,
    pub unread: u32,
    pub timer: Option<u32>,
    pub mute: Mute,
}

impl From<core::Conversation> for Conversation {
    fn from(conversation: core::Conversation) -> Self {
        Self {
            id: conversation.id,
            state: conversation.state.into(),
            name: conversation.name,
            members: people(conversation.members),
            last: conversation.last.map(Into::into),
            unread: conversation.unread,
            timer: conversation.timer,
            mute: conversation.mute.into(),
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
        Self {
            conversation: message.conversation,
            seq: message.seq,
            sender_account: message.sender.account,
            sender_device: message.sender.device,
            envelope: Envelope {
                id: message.envelope.id,
                ts: message.envelope.ts,
                body: message.envelope.body,
            },
            own: message.own,
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
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Event {
    Message {
        message: Box<Message>,
    },
    Membership {
        conversation: String,
        added: Vec<String>,
        removed: Vec<String>,
    },
    Joined {
        conversation: String,
    },
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
    Timeline {
        conversation: String,
        changed: Vec<u64>,
    },
    Profiles {
        accounts: Vec<String>,
    },
    Expired {
        conversation: String,
        removed: Vec<u64>,
    },
}

impl From<core::Event> for Event {
    fn from(event: core::Event) -> Self {
        use core::Event as E;
        match event {
            E::Message(message) => Self::Message {
                message: Box::new(message.into()),
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
                    .map(|device| GroupDevice {
                        account: device.account,
                        device: device.device,
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
            E::Expired {
                conversation,
                removed,
            } => Self::Expired {
                conversation,
                removed,
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
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
        Self {
            account_id: me.account_id,
            name: me.name,
            verified: me.verified,
            devices: me
                .devices
                .into_iter()
                .map(|device| AccountDevice {
                    device_id: device.device_id,
                    platform: device.platform,
                    kind: match device.kind {
                        api::DeviceKind::Phone => "phone",
                        api::DeviceKind::Web => "web",
                    },
                    created_at: device.created_at,
                    current: device.current,
                })
                .collect(),
            photo: me.photo,
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
        Self {
            code: link.code,
            link_id: link.link_id,
            expires_at: link.expires_at,
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
