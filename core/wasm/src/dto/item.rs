//! A row of the conversation, as the page gets it.

use serde::Serialize;
use spjall_client as core;

use super::{Content, Person, Status, people};

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
    pub read_here: Vec<Person>,
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
            read_here,
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
            read_here: people(read_here),
            expires_at,
            forwarded,
        }
    }
}
