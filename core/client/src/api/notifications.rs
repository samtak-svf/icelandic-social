//! Notifications (0063, 0103 to 0106): the rows, the page, the levels and the
//! calls that list, mark and set them.

use serde::{Deserialize, Serialize};

use super::{Api, ApiError, Author, Method, Transport, with_query};

/// What a notification is about (0063).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationKind {
    /// A comment on the caller's post.
    Comment,
    /// A reply to the caller's comment (0103).
    Reply,
    /// A reaction on the caller's post.
    Reaction,
    /// A moderator approved the caller's join request.
    JoinApproved,
    /// A moderator acted on the caller's content; `action` says how.
    Moderated,
    /// An account asked the caller to be friends (0114).
    FriendRequest,
    /// An account took the caller's request (0114).
    FriendAccepted,
}

/// How loudly the caller is told (0106): nothing, a row in the list, or a
/// row and a push.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NotificationLevel {
    Off,
    InApp,
    Push,
}

/// The caller's levels (0106): one for each kind, and one for each
/// community that has one set (the others are `Push`). A notification's
/// effective level is the lower of its kind's and its community's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationSettings {
    /// Every kind, in the order of `NotificationKind`.
    pub kinds: Vec<(NotificationKind, NotificationLevel)>,
    /// `(community id, level)`.
    pub communities: Vec<(String, NotificationLevel)>,
}

/// The kinds, in the order `NotificationSettings::kinds` lists them, with
/// the name the server keys them by.
const NOTIFICATION_KINDS: [(NotificationKind, &str); 7] = [
    (NotificationKind::Comment, "comment"),
    (NotificationKind::Reply, "reply"),
    (NotificationKind::Reaction, "reaction"),
    (NotificationKind::JoinApproved, "join_approved"),
    (NotificationKind::Moderated, "moderated"),
    (NotificationKind::FriendRequest, "friend_request"),
    (NotificationKind::FriendAccepted, "friend_accepted"),
];

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentSettings {
    kinds: std::collections::HashMap<String, serde_json::Value>,
    communities: Vec<SentCommunityLevel>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentCommunityLevel {
    community_id: String,
    level: serde_json::Value,
}

/// What a `Moderated` notification says was done. Not `ModerationAction`,
/// which is what a moderator may send: this is only read, and carries the
/// server's own notices too. A value a later server adds reads as `Unknown`,
/// as `ModerationLogAction` does.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
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
    /// A platform moderator cleared the caller's photo (no community).
    ClearAccountPhoto,
    /// A platform moderator suspended the caller's account (no community).
    SuspendAccount,
    /// A platform moderator lifted the suspension (no community).
    UnsuspendAccount,
    /// A moderator declined the caller's anonymous post (no post id).
    DeclineAnonymousPost,
    /// The caller's review came back: the action stands (0115).
    ReviewUpheld,
    /// The caller's review came back: the action was undone (0115).
    ReviewOverturned,
    /// A platform moderator cleared the caller's bio (0115); no community.
    ClearAccountBio,
    /// A platform moderator cleared the caller's cover (0115); no community.
    ClearAccountCover,
    #[serde(other)]
    Unknown,
}

/// Something addressed to the caller. It carries ids, never the content:
/// the post or comment is read through the same checks as any other.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Notification {
    pub notification_id: String,
    pub kind: NotificationKind,
    /// Who did it; none once that account is deleted.
    pub actor: Option<Author>,
    /// The newest three distinct accounts behind it, newest first (0103);
    /// empty from a server before that.
    pub actors: Vec<Author>,
    /// How many distinct accounts caused it; 0 from a server before 0103.
    pub actor_count: u64,
    /// The newest comment's text, or the post's for a reaction, cut at 100
    /// characters (0105); none when the caller may no longer read it. Never
    /// shown on a lock screen.
    pub snippet: Option<String>,
    /// Whether the row is unread and its effective level is `Push` now
    /// (0106): only such a row may be announced (0107).
    pub announce: bool,
    /// None for a row about the account itself (0114): it is in no community.
    pub community_id: Option<String>,
    pub post_id: Option<String>,
    pub comment_id: Option<String>,
    /// For `Moderated`, the moderator's action.
    pub action: Option<NotificationAction>,
    /// For `Reaction`, the emoji (0100); none on a notification made before.
    pub emoji: Option<String>,
    /// Unix milliseconds.
    pub created_at: u64,
    pub read: bool,
}

/// A page of notifications, newest first; `unread` counts all of the
/// caller's, not only this page's.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NotificationPage {
    pub notifications: Vec<Notification>,
    pub unread: u64,
    /// Unread rows newer than `seen_at` (0104); 0 from a server before it.
    pub unseen: u64,
    /// When the caller last saw its list, before this call; none if never.
    pub seen_at: Option<u64>,
    pub next: Option<String>,
}

/// A notification as the server sends it: a kind or an action this build
/// does not know is left out rather than failing the page, since the server
/// adds kinds before the apps show them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentNotification {
    notification_id: String,
    kind: serde_json::Value,
    actor: Option<Author>,
    #[serde(default)]
    actors: Vec<Author>,
    #[serde(default)]
    actor_count: u64,
    #[serde(default)]
    snippet: Option<String>,
    #[serde(default)]
    announce: bool,
    community_id: Option<String>,
    post_id: Option<String>,
    comment_id: Option<String>,
    action: Option<serde_json::Value>,
    #[serde(default)]
    emoji: Option<String>,
    created_at: u64,
    read: bool,
}

impl SentNotification {
    fn known(self) -> Option<Notification> {
        Some(Notification {
            notification_id: self.notification_id,
            kind: serde_json::from_value(self.kind).ok()?,
            actor: self.actor,
            actors: self.actors,
            actor_count: self.actor_count,
            snippet: self.snippet,
            announce: self.announce,
            community_id: self.community_id,
            post_id: self.post_id,
            comment_id: self.comment_id,
            // A present value is always kept: one that is not even a string
            // reads as `Unknown`, like an unheard-of name.
            action: self
                .action
                .map(|a| serde_json::from_value(a).unwrap_or(NotificationAction::Unknown)),
            emoji: self.emoji,
            created_at: self.created_at,
            read: self.read,
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SentNotifications {
    notifications: Vec<SentNotification>,
    unread: u64,
    #[serde(default)]
    unseen: u64,
    #[serde(default)]
    seen_at: Option<u64>,
    next: Option<String>,
}

impl<T: Transport + ?Sized> Api<'_, T> {
    /// `notifications`: newest first, older than `before`.
    pub fn notifications(
        &self,
        before: Option<&str>,
        limit: u32,
    ) -> Result<NotificationPage, ApiError> {
        let limit = limit.to_string();
        let params = [("before", before), ("limit", Some(limit.as_str()))];
        let path = with_query("/v1/notifications", &params);
        let page: SentNotifications = self.call(Method::Get, path, None, "notifications")?;
        Ok(NotificationPage {
            notifications: page
                .notifications
                .into_iter()
                .filter_map(SentNotification::known)
                .collect(),
            unread: page.unread,
            unseen: page.unseen,
            seen_at: page.seen_at,
            next: page.next,
        })
    }

    /// `readNotifications`: every one made at or before `up_to`, in Unix
    /// milliseconds.
    pub fn read_notifications(&self, up_to: u64) -> Result<(), ApiError> {
        let body = serde_json::json!({ "upTo": up_to });
        self.done(
            Method::Post,
            "/v1/notifications/read".into(),
            Self::json(&body),
        )
    }

    /// `seenNotifications` (0104): the list was looked at up to `up_to`, in
    /// Unix milliseconds. It never reads a row.
    pub fn seen_notifications(&self, up_to: u64) -> Result<(), ApiError> {
        let body = serde_json::json!({ "upTo": up_to });
        self.done(
            Method::Post,
            "/v1/notifications/seen".into(),
            Self::json(&body),
        )
    }

    /// `readNotifications` for one row: read, or unread again.
    pub fn read_notification(&self, id: &str, read: bool) -> Result<(), ApiError> {
        let body = serde_json::json!({ "notificationId": id, "read": read });
        self.done(
            Method::Post,
            "/v1/notifications/read".into(),
            Self::json(&body),
        )
    }

    /// `deleteNotification`.
    pub fn delete_notification(&self, id: &str) -> Result<(), ApiError> {
        let path = format!("/v1/notifications/{}", crate::account::encode(id));
        self.done(Method::Delete, path, None)
    }

    /// `notificationSettings`: a kind or a community level this build does
    /// not know reads as `Push`, the server's default, so the screen never
    /// shows a quieter state than the server holds.
    pub fn notification_settings(&self) -> Result<NotificationSettings, ApiError> {
        let sent: SentSettings = self.call(
            Method::Get,
            "/v1/notification-settings".into(),
            None,
            "notificationSettings",
        )?;
        let level = |value: Option<&serde_json::Value>| {
            value
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or(NotificationLevel::Push)
        };
        Ok(NotificationSettings {
            kinds: NOTIFICATION_KINDS
                .iter()
                .map(|(kind, name)| (*kind, level(sent.kinds.get(*name))))
                .collect(),
            communities: sent
                .communities
                .into_iter()
                .map(|c| (c.community_id, level(Some(&c.level))))
                .collect(),
        })
    }

    /// `putNotificationSettings`: sets the given kinds and leaves the rest.
    pub fn set_notification_settings(
        &self,
        kinds: &[(NotificationKind, NotificationLevel)],
    ) -> Result<(), ApiError> {
        let mut map = serde_json::Map::new();
        for (kind, level) in kinds {
            map.insert(
                serde_json::to_value(kind)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_owned))
                    .unwrap_or_default(),
                serde_json::to_value(level).unwrap_or_default(),
            );
        }
        let body = serde_json::json!({ "kinds": map });
        self.done(
            Method::Put,
            "/v1/notification-settings".into(),
            Self::json(&body),
        )
    }

    /// `setCommunityNotificationLevel`.
    pub fn set_community_notification_level(
        &self,
        community: &str,
        level: NotificationLevel,
    ) -> Result<(), ApiError> {
        let body = serde_json::json!({ "level": level });
        self.done(
            Method::Put,
            format!("/v1/communities/{community}/notification-level"),
            Self::json(&body),
        )
    }
}

#[cfg(test)]
mod contract_tests {
    use super::NotificationKind;

    /// The Worker keeps these from an app below its version floor (`shownTo`), so
    /// this core never decodes them: the moderators' notice until it has a queue.
    const WITHHELD: [&str; 1] = ["reports_waiting"];

    #[test]
    fn core_decodes_every_kind_the_worker_lets_it_see() {
        let contract: serde_json::Value =
            serde_json::from_str(include_str!("../../../../api/openapi.json")).unwrap();
        let kinds = contract
            .pointer("/components/schemas/Notification/properties/kind/enum")
            .and_then(serde_json::Value::as_array)
            .unwrap();
        let decodes = |kind: &serde_json::Value| {
            serde_json::from_value::<NotificationKind>(kind.clone()).is_ok()
        };
        let (held, shown): (Vec<_>, Vec<_>) = kinds
            .iter()
            .partition(|kind| WITHHELD.contains(&kind.as_str().unwrap()));
        assert_eq!(held.len(), WITHHELD.len());
        assert_eq!(shown.len(), 7);
        assert!(shown.iter().copied().all(decodes));
        assert!(!held.iter().copied().any(decodes));
    }
}
