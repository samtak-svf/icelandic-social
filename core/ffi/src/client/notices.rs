//! What to show after a push (0025, 0107): the chat notices and the social
//! ones, and which to take away.

use spjall_client as core;

use crate::client::Person;
use crate::client::people;
use crate::social::SocialNotificationKind;
use crate::social::{Author, NotificationAction};

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum NoticeKind {
    Text,
    Photo,
    File,
    /// A post shared under 0040: shown as a fixed sentence, with no text.
    Post,
    /// A location (0059): a fixed sentence, never the place.
    Location,
}

/// A new message to show after a push (0025).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Notice {
    pub conversation: String,
    /// Everyone there but this account, named ones first: the title.
    pub members: Vec<Person>,
    pub seq: u64,
    pub sender: Person,
    pub kind: NoticeKind,
    /// The text, or a file's caption; none for a shared post.
    pub text: Option<String>,
    /// When the server stored it (0048), or the sender's clock for a row
    /// stored before the server gave it; in milliseconds.
    pub ts: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Notices {
    /// Oldest first.
    pub shown: Vec<Notice>,
    /// Conversations whose notifications to take away, before showing.
    pub cleared: Vec<String>,
    /// Social notifications to announce (0107), oldest first. The app
    /// writes the sentence with the list row's formatter.
    pub social: Vec<SocialNotice>,
    /// Ids of social notifications whose notice to take away, before
    /// showing: the row was read, here or elsewhere, or deleted.
    pub social_cleared: Vec<String>,
}

/// A social notification to announce on a locked screen (0107). It carries
/// no snippet and nothing that is not in the list row.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SocialNotice {
    /// The `notification_id` of the row; `social_cleared` names it too.
    pub notification_id: String,
    pub kind: SocialNotificationKind,
    /// The newest three accounts behind it, newest first.
    pub actors: Vec<Author>,
    /// How many distinct accounts caused it, `actors` among them.
    pub actor_count: u64,
    /// None for a row about the account itself (0114).
    pub community_id: Option<String>,
    /// The post to open on a tap; none opens the community, if any.
    pub post_id: Option<String>,
    pub comment_id: Option<String>,
    /// For `Moderated`, what was done; `Unknown` for an action a later server
    /// adds, none when the row has none.
    pub action: Option<NotificationAction>,
    /// For `Reaction`, the emoji.
    pub emoji: Option<String>,
    /// Unix milliseconds.
    pub created_at: u64,
}

impl From<core::SocialNotice> for SocialNotice {
    fn from(notice: core::SocialNotice) -> Self {
        let core::SocialNotice {
            notification_id,
            kind,
            actors,
            actor_count,
            community_id,
            post_id,
            comment_id,
            action,
            emoji,
            created_at,
        } = notice;
        Self {
            notification_id,
            kind: kind.into(),
            actors,
            actor_count,
            community_id,
            post_id,
            comment_id,
            action,
            emoji,
            created_at,
        }
    }
}

impl From<core::Notices> for Notices {
    fn from(notices: core::Notices) -> Self {
        let core::Notices {
            cleared,
            shown,
            social,
            social_cleared,
        } = notices;

        Self {
            shown: shown
                .into_iter()
                .map(
                    |core::Notice {
                         conversation,
                         members,
                         seq,
                         sender,
                         kind,
                         text,
                         ts,
                     }| Notice {
                        conversation,
                        members: people(members),
                        seq,
                        sender,
                        kind: match kind {
                            core::NoticeKind::Text => NoticeKind::Text,
                            core::NoticeKind::Photo => NoticeKind::Photo,
                            core::NoticeKind::File => NoticeKind::File,
                            core::NoticeKind::Post => NoticeKind::Post,
                            core::NoticeKind::Location => NoticeKind::Location,
                        },
                        text,
                        ts,
                    },
                )
                .collect(),
            cleared,
            social: social.into_iter().map(Into::into).collect(),
            social_cleared,
        }
    }
}
