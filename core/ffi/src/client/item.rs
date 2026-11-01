//! A row of the conversation, as the app gets it.

use spjall_client as core;

use crate::client::{Content, ItemStatus, Person, people};

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
    /// The members besides this account who have read up to here and no
    /// further (0125); empty with read markers off and while being sent.
    #[uniffi(default = [])]
    pub read_here: Vec<Person>,
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
            read_here,
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
            read_here: people(read_here),
        }
    }
}
