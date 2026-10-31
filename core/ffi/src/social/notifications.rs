//! Notifications (0063, 0103 to 0106) as the apps see them: the list, what was
//! seen and read, and the levels.

use spjall_client::api;
pub use spjall_client::api::{NotificationAction, NotificationLevel};

use crate::CoreError;
use crate::client::CoreClient;
use crate::social::Author;

/// What a `Moderated` notification says was done; `Unknown` for a value a
/// later server adds. Apart from `ModerationAction`, which is what a
/// moderator may send.
#[uniffi::remote(Enum)]
pub enum NotificationAction {
    HidePost,
    RemovePost,
    RestorePost,
    HideComment,
    RemoveComment,
    RestoreComment,
    MuteMember,
    UnmuteMember,
    RemoveMember,
    BanMember,
    UnbanMember,
    /// A platform moderator cleared this account's photo; there is no community.
    ClearAccountPhoto,
    /// A platform moderator suspended this account; there is no community.
    SuspendAccount,
    /// A platform moderator lifted the suspension; there is no community.
    UnsuspendAccount,
    /// A moderator declined the caller's anonymous post; there is no post id.
    DeclineAnonymousPost,
    /// This account's review came back: the action stands (0115).
    ReviewUpheld,
    /// This account's review came back: the action was undone (0115).
    ReviewOverturned,
    /// A platform moderator cleared this account's bio (0115); no community.
    ClearAccountBio,
    /// A platform moderator cleared this account's cover (0115); no community.
    ClearAccountCover,
    Unknown,
}

/// What a notification tells. Named apart from the platforms' own
/// `Notification` types, which an app imports beside this one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum SocialNotificationKind {
    /// A comment on this account's post.
    Comment,
    /// A reply to this account's comment (0103).
    Reply,
    /// A reaction on this account's post.
    Reaction,
    /// A moderator approved this account's join request.
    JoinApproved,
    /// A moderator acted on this account's post or comment; `action` says
    /// how.
    Moderated,
    /// An account asked this one to be friends (0114): `actor` names it.
    FriendRequest,
    /// An account took this one's request (0114): `actor` names it.
    FriendAccepted,
}

/// Something addressed to this account. It carries ids, never the
/// content: the app reads the post or comment with `post` or `comments`.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SocialNotification {
    pub notification_id: String,
    pub kind: SocialNotificationKind,
    /// Who did it; none for a moderator's action or a deleted account.
    pub actor: Option<Author>,
    /// The newest three distinct accounts behind it, newest first (0103);
    /// empty from a server before that.
    pub actors: Vec<Author>,
    /// How many distinct accounts caused it, `actors` among them; 0 from a
    /// server before 0103.
    pub actor_count: u64,
    /// The newest comment's text, or the post's for a reaction, at most 100
    /// characters (0105); none when this account may no longer read it. The
    /// list shows it; a lock-screen notice never does.
    pub snippet: Option<String>,
    /// Whether the row is unread and its effective level is `Push` now
    /// (0106).
    pub announce: bool,
    /// None for a row about the account itself (0114): it is in no community.
    pub community_id: Option<String>,
    pub post_id: Option<String>,
    pub comment_id: Option<String>,
    /// For `Moderated`, what was done; `Unknown` for an action a later server
    /// adds, none when the row has none.
    pub action: Option<NotificationAction>,
    /// For `Reaction`, the emoji (0100).
    pub emoji: Option<String>,
    /// Unix milliseconds: the `up_to` of `read_notifications`.
    pub created_at: u64,
    pub read: bool,
}

impl From<api::Notification> for SocialNotification {
    fn from(notification: api::Notification) -> Self {
        let api::Notification {
            notification_id,
            kind,
            actor,
            actors,
            actor_count,
            snippet,
            announce,
            community_id,
            post_id,
            comment_id,
            action,
            emoji,
            created_at,
            read,
        } = notification;

        use api::NotificationKind as K;
        Self {
            notification_id,
            kind: match kind {
                K::Comment => SocialNotificationKind::Comment,
                K::Reply => SocialNotificationKind::Reply,
                K::Reaction => SocialNotificationKind::Reaction,
                K::JoinApproved => SocialNotificationKind::JoinApproved,
                K::Moderated => SocialNotificationKind::Moderated,
                K::FriendRequest => SocialNotificationKind::FriendRequest,
                K::FriendAccepted => SocialNotificationKind::FriendAccepted,
            },
            actor,
            actors,
            actor_count,
            snippet,
            announce,
            community_id,
            post_id,
            comment_id,
            action,
            emoji,
            created_at,
            read,
        }
    }
}

impl From<SocialNotificationKind> for api::NotificationKind {
    fn from(kind: SocialNotificationKind) -> Self {
        use SocialNotificationKind as K;
        match kind {
            K::Comment => Self::Comment,
            K::Reply => Self::Reply,
            K::Reaction => Self::Reaction,
            K::JoinApproved => Self::JoinApproved,
            K::Moderated => Self::Moderated,
            K::FriendRequest => Self::FriendRequest,
            K::FriendAccepted => Self::FriendAccepted,
        }
    }
}

impl From<api::NotificationKind> for SocialNotificationKind {
    fn from(kind: api::NotificationKind) -> Self {
        use api::NotificationKind as K;
        match kind {
            K::Comment => Self::Comment,
            K::Reply => Self::Reply,
            K::Reaction => Self::Reaction,
            K::JoinApproved => Self::JoinApproved,
            K::Moderated => Self::Moderated,
            K::FriendRequest => Self::FriendRequest,
            K::FriendAccepted => Self::FriendAccepted,
        }
    }
}

/// How loudly this account is told (0106). The effective level of a
/// notification is the lower of its kind's and its community's.
#[uniffi::remote(Enum)]
pub enum NotificationLevel {
    /// Nothing is written.
    Off,
    /// A row in the list, no push.
    InApp,
    /// A row and a push; the default.
    Push,
}

/// The level of one kind of notification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Record)]
pub struct NotificationKindLevel {
    pub kind: SocialNotificationKind,
    pub level: NotificationLevel,
}

/// The level of one community.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CommunityNotificationLevel {
    pub community_id: String,
    pub level: NotificationLevel,
}

/// This account's levels (0106).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct NotificationSettings {
    /// Every kind, in the order of `SocialNotificationKind`.
    pub kinds: Vec<NotificationKindLevel>,
    /// The communities with a level set; the others are `Push`.
    pub communities: Vec<CommunityNotificationLevel>,
}

/// A page of notifications, newest first. A kind this build does not know
/// is left out.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct SocialNotificationPage {
    pub notifications: Vec<SocialNotification>,
    /// How many of this account's notifications are unread, on every page.
    pub unread: u64,
    /// How many unread notifications are newer than `seen_at` (0104): the
    /// badge. 0 from a server before it.
    pub unseen: u64,
    /// When this account last saw its list, before this call, in Unix
    /// milliseconds; none if never.
    pub seen_at: Option<u64>,
    /// The `before` of the next, older page; none on the last.
    pub next: Option<String>,
}

/// Notifications.
#[uniffi::export]
impl CoreClient {
    /// A page of this account's notifications, newest first; `before` is
    /// the `next` of the page before. At most 50 a page.
    pub fn notifications(
        &self,
        before: Option<String>,
        limit: u32,
    ) -> Result<SocialNotificationPage, CoreError> {
        let page = self.hosted.notifications(before.as_deref(), limit)?;
        Ok(SocialNotificationPage {
            notifications: page.notifications.into_iter().map(Into::into).collect(),
            unread: page.unread,
            unseen: page.unseen,
            seen_at: page.seen_at,
            next: page.next,
        })
    }

    /// Marks read every notification made at or before `up_to`: the
    /// `created_at` of the newest one shown.
    pub fn read_notifications(&self, up_to: u64) -> Result<(), CoreError> {
        Ok(self.hosted.read_notifications(up_to)?)
    }

    /// Records that the list was looked at up to `up_to`, the `created_at`
    /// of the newest row shown; it clears the badge and reads no row (0104).
    pub fn seen_notifications(&self, up_to: u64) -> Result<(), CoreError> {
        Ok(self.hosted.seen_notifications(up_to)?)
    }

    /// Marks one notification read, or unread again.
    pub fn read_notification(&self, notification_id: String, read: bool) -> Result<(), CoreError> {
        Ok(self.hosted.read_notification(&notification_id, read)?)
    }

    /// Removes one notification from the list.
    pub fn delete_notification(&self, notification_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.delete_notification(&notification_id)?)
    }

    /// The level for each kind and each community that has one (0106).
    pub fn notification_settings(&self) -> Result<NotificationSettings, CoreError> {
        let settings = self.hosted.notification_settings()?;
        Ok(NotificationSettings {
            kinds: settings
                .kinds
                .into_iter()
                .map(|(kind, level)| NotificationKindLevel {
                    kind: kind.into(),
                    level,
                })
                .collect(),
            communities: settings
                .communities
                .into_iter()
                .map(|(community_id, level)| CommunityNotificationLevel {
                    community_id,
                    level,
                })
                .collect(),
        })
    }

    /// Sets the level of the given kinds and leaves the others. `Moderated`
    /// cannot be `Off`: the server refuses it.
    pub fn set_notification_settings(
        &self,
        kinds: Vec<NotificationKindLevel>,
    ) -> Result<(), CoreError> {
        let kinds: Vec<_> = kinds
            .into_iter()
            .map(|k| (k.kind.into(), k.level))
            .collect();
        Ok(self.hosted.set_notification_settings(&kinds)?)
    }

    /// Sets how loudly this account is told of one community.
    pub fn set_community_notification_level(
        &self,
        community_id: String,
        level: NotificationLevel,
    ) -> Result<(), CoreError> {
        Ok(self
            .hosted
            .set_community_notification_level(&community_id, level)?)
    }
}
