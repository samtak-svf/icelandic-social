//! Communities, posts, comments, reactions, reports, moderation and
//! notifications (0063) as the apps see them. The core builds each request
//! and the app's `Transport` carries it (0018). Nothing here is stored on
//! the device but a post's images, kept as files: each call asks the
//! server, and may block on the network.

use std::path::Path;

use spjall_client::api;
pub mod friends;
pub mod home;
pub mod moderation_reviews;
pub mod notifications;
pub mod posts;
pub mod wall;
pub use friends::*;
pub use home::*;
pub use moderation_reviews::*;
pub use notifications::*;
pub use posts::*;
pub use spjall_client::api::{JoinRequest, JoinState};
pub use wall::*;

use crate::CoreError;
use crate::client::CoreClient;
use crate::foreign::path_string;
use crate::frames::{Frame, Framing};
pub use spjall_client::api::Author;
pub use spjall_client::api::AuthorRole;
pub use spjall_client::api::CardCommunity;
pub use spjall_client::api::CommunityImage;
pub use spjall_client::api::ModerationAction;
pub use spjall_client::api::ModerationState;
pub use spjall_client::api::ReportDecision;
pub use spjall_client::api::ReportReason;
pub use spjall_client::api::ReportState;
pub use spjall_client::api::TargetStanding;
pub use spjall_client::api::TargetState;

/// Who wrote a post or a comment, did what a notification tells, or is
/// reported. Its photo is not named here; `profile` gives it.
#[uniffi::remote(Record)]
pub struct Author {
    pub account_id: String,
    /// None for an account that never gave one.
    pub name: Option<String>,
    pub verified: bool,
    /// The version of the account's photo, which `profile_photo` takes (0080).
    #[uniffi(default = None)]
    pub photo: Option<String>,
    /// The role in the community the content belongs to (0080).
    #[uniffi(default = None)]
    pub role: Option<AuthorRole>,
}

/// A role worth a badge. `Unknown` is a role a newer server added.
#[uniffi::remote(Enum)]
pub enum AuthorRole {
    Owner,
    Moderator,
    Unknown,
}

/// Who reads a community and how one joins it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum CommunityAudience {
    /// Every signed-in account reads it and joins at once.
    Open,
    /// Only members read it; joining takes a moderator's approval or an
    /// invitation.
    Private,
}

impl From<api::Audience> for CommunityAudience {
    fn from(audience: api::Audience) -> Self {
        match audience {
            api::Audience::Open => Self::Open,
            api::Audience::Private => Self::Private,
        }
    }
}

impl From<CommunityAudience> for api::Audience {
    fn from(audience: CommunityAudience) -> Self {
        match audience {
            CommunityAudience::Open => Self::Open,
            CommunityAudience::Private => Self::Private,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum CommunityRole {
    Owner,
    Moderator,
    Member,
}

impl From<api::Role> for CommunityRole {
    fn from(role: api::Role) -> Self {
        match role {
            api::Role::Owner => Self::Owner,
            api::Role::Moderator => Self::Moderator,
            api::Role::Member => Self::Member,
        }
    }
}

impl From<CommunityRole> for api::Role {
    fn from(role: CommunityRole) -> Self {
        match role {
            CommunityRole::Owner => Self::Owner,
            CommunityRole::Moderator => Self::Moderator,
            CommunityRole::Member => Self::Member,
        }
    }
}

/// A community as this account sees it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Community {
    pub community_id: String,
    pub name: String,
    pub description: String,
    pub audience: CommunityAudience,
    /// Unix milliseconds.
    pub created_at: u64,
    /// None for a private community this account is not a member of.
    pub member_count: Option<u64>,
    /// This account's role; none when it is not a member.
    pub role: Option<CommunityRole>,
    /// This account's join request waits for a moderator.
    pub join_requested: bool,
    /// A moderator invited this account: joining takes it at once.
    pub invited: bool,
    /// Until when, in Unix milliseconds, a moderator muted this account
    /// here: it reads, but does not post, comment or react.
    pub muted_until: Option<u64>,
    /// Its owner's account was deleted and no moderator was left to take
    /// it over; it is deleted 90 days later.
    pub read_only: bool,
    /// Unix milliseconds when it was deleted; it can be restored for 30
    /// days after.
    pub deleted_at: Option<u64>,
    /// Unix milliseconds: this account's join request was declined, and it
    /// may ask again from then.
    pub join_declined_until: Option<u64>,
    /// Join requests that wait; none unless this account moderates.
    pub pending_join_requests: Option<u64>,
    /// Open reports in its queue; none unless this account moderates.
    #[uniffi(default = None)]
    pub open_reports: Option<u64>,
    /// The picture's version (0080); none when it has no picture.
    #[uniffi(default = None)]
    pub photo: Option<String>,
    /// The cover's version (0080); none when it has no cover.
    #[uniffi(default = None)]
    pub cover: Option<String>,
    /// How the picture is framed (0086); none without a picture or for one
    /// set before frames.
    #[uniffi(default = None)]
    pub photo_frames: Option<Framing>,
    /// How the cover is framed, with a rectangle for each size class the
    /// person adjusted (0086); none without a cover or for one set before
    /// frames.
    #[uniffi(default = None)]
    pub cover_frames: Option<Framing>,
    /// Posts made since this account last opened the feed (0080).
    #[uniffi(default = 0)]
    pub unread: u64,
    /// Unix milliseconds when the latest post was made (0080).
    #[uniffi(default = None)]
    pub last_post_at: Option<u64>,
    /// This account pinned it to the top of its list (0080).
    #[uniffi(default = false)]
    pub pinned: bool,
    /// Members may post without their name, for a moderator's approval
    /// (0091).
    #[uniffi(default = false)]
    pub anonymous_posts: bool,
    /// Anonymous posts that wait for approval; 0 unless this account
    /// moderates (0091).
    #[uniffi(default = 0)]
    pub pending_anonymous: u64,
    /// The posts its moderators feature, up to three, newest pin first
    /// (0088); `community` fills it, the lists do not.
    #[uniffi(default = [])]
    pub featured: Vec<Post>,
}

/// An account asking to join a private community.
#[uniffi::remote(Record)]
pub struct JoinRequest {
    pub account_id: String,
    /// None for an account that never gave one.
    pub name: Option<String>,
    pub verified: bool,
    /// Unix milliseconds.
    pub requested_at: u64,
}

impl From<api::Community> for Community {
    fn from(community: api::Community) -> Self {
        let api::Community {
            community_id,
            name,
            description,
            audience,
            created_at,
            member_count,
            role,
            join_requested,
            invited,
            muted_until,
            read_only,
            deleted_at,
            join_declined_until,
            pending_join_requests,
            open_reports,
            photo,
            cover,
            photo_frames,
            cover_frames,
            unread,
            last_post_at,
            pinned,
            anonymous_posts,
            pending_anonymous,
            featured,
        } = community;

        Self {
            community_id,
            name,
            description,
            audience: audience.into(),
            created_at,
            member_count,
            role: role.map(Into::into),
            join_requested,
            invited,
            muted_until,
            read_only,
            deleted_at,
            join_declined_until,
            pending_join_requests,
            open_reports,
            photo,
            cover,
            photo_frames: photo_frames.map(Into::into),
            cover_frames: cover_frames.map(Into::into),
            unread,
            last_post_at,
            pinned,
            anonymous_posts,
            pending_anonymous,
            featured: featured.into_iter().map(Into::into).collect(),
        }
    }
}

fn communities(communities: Vec<api::Community>) -> Vec<Community> {
    communities.into_iter().map(Into::into).collect()
}

/// An account in a community's member list, with the role it holds there.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CommunityMember {
    pub account_id: String,
    /// None for an account that never gave one.
    pub name: Option<String>,
    pub verified: bool,
    pub role: CommunityRole,
    /// Unix milliseconds.
    pub joined_at: u64,
    /// The account's photo version; `photo` fetches it.
    pub photo: Option<String>,
}

impl From<api::CommunityMember> for CommunityMember {
    fn from(member: api::CommunityMember) -> Self {
        let api::CommunityMember {
            account_id,
            name,
            verified,
            role,
            joined_at,
            photo,
        } = member;

        Self {
            account_id,
            name,
            verified,
            role: role.into(),
            joined_at,
            photo,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CommunityPage {
    pub communities: Vec<Community>,
    /// The `after` of the next page, none on the last.
    pub next: Option<String>,
}

/// What joining did.
#[uniffi::remote(Enum)]
pub enum JoinState {
    /// This account is a member now.
    Member,
    /// The request waits for a moderator of a private community.
    Requested,
}

/// An image of a post: a WebP the server re-encoded.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct PostImage {
    pub media_id: String,
    pub width: u32,
    pub height: u32,
}

impl From<api::SocialMedia> for PostImage {
    fn from(media: api::SocialMedia) -> Self {
        let api::SocialMedia {
            media_id,
            width,
            height,
        } = media;

        Self {
            media_id,
            width,
            height,
        }
    }
}

/// An image in a community's posts or comments (0089); fetch it with the
/// post's media under `post_id`.
#[uniffi::remote(Record)]
pub struct CommunityImage {
    pub media_id: String,
    pub post_id: String,
    /// The comment that carries it; none for a post's own image.
    pub comment_id: Option<String>,
    pub width: u32,
    pub height: u32,
    /// Unix milliseconds.
    pub created_at: u64,
}

/// A page of a community's images, newest first. A page may be short, or
/// empty, with more after it.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CommunityImagePage {
    pub images: Vec<CommunityImage>,
    /// The `cursor` of the next, older page; none on the last.
    pub next: Option<String>,
}

/// One emoji on a post with how many accounts reacted with it (0100).
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct EmojiCount {
    pub emoji: String,
    pub count: u64,
}

/// Whether a moderator hid or removed a post or a comment. Only a
/// moderator is shown one that is not `Visible`.
#[uniffi::remote(Enum)]
pub enum ModerationState {
    Visible,
    /// An anonymous post waiting for a moderator's approval (0091).
    Pending,
    Hidden,
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Comment {
    /// The post's id, a hyphen, and the comment's own part.
    pub comment_id: String,
    pub post_id: String,
    /// The comment this one answers, when it is a reply.
    #[uniffi(default = None)]
    pub parent_comment_id: Option<String>,
    pub author: Author,
    pub body: String,
    /// Unix milliseconds.
    pub created_at: u64,
    pub state: ModerationState,
    /// How many accounts liked it (0080).
    #[uniffi(default = 0)]
    pub likes: u64,
    /// This account liked it.
    #[uniffi(default = false)]
    pub liked: bool,
    /// The comment's image, none or one (0082).
    #[uniffi(default = [])]
    pub images: Vec<PostImage>,
}

impl From<api::Comment> for Comment {
    fn from(comment: api::Comment) -> Self {
        let api::Comment {
            comment_id,
            post_id,
            parent_comment_id,
            author,
            body,
            created_at,
            state,
            likes,
            liked,
            media,
        } = comment;

        Self {
            comment_id,
            post_id,
            parent_comment_id,
            author,
            body,
            created_at,
            state,
            likes,
            liked,
            images: media.into_iter().map(Into::into).collect(),
        }
    }
}

/// A page of a post's comments, oldest first.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CommentPage {
    pub comments: Vec<Comment>,
    /// The `after` of the next page; none on the last.
    pub next: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum ReportTargetKind {
    Post,
    Comment,
    Community,
    Account,
}

/// What a report is about: a post, a comment, a community or an account.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ReportTarget {
    pub kind: ReportTargetKind,
    pub id: String,
}

impl From<api::Target> for ReportTarget {
    fn from(target: api::Target) -> Self {
        let api::Target { kind, id } = target;

        use api::TargetKind as K;
        Self {
            kind: match kind {
                K::Post => ReportTargetKind::Post,
                K::Comment => ReportTargetKind::Comment,
                K::Community => ReportTargetKind::Community,
                K::Account => ReportTargetKind::Account,
            },
            id,
        }
    }
}

impl From<ReportTarget> for api::Target {
    fn from(target: ReportTarget) -> Self {
        let ReportTarget { kind, id } = target;

        use api::TargetKind as K;
        Self {
            kind: match kind {
                ReportTargetKind::Post => K::Post,
                ReportTargetKind::Comment => K::Comment,
                ReportTargetKind::Community => K::Community,
                ReportTargetKind::Account => K::Account,
            },
            id,
        }
    }
}

#[uniffi::remote(Enum)]
pub enum ReportReason {
    Unlawful,
    Harassment,
    Spam,
    Other,
}

#[uniffi::remote(Enum)]
pub enum ReportState {
    Open,
    Closed,
}

/// What closed a report; `Unknown` for a value a later server adds.
#[uniffi::remote(Enum)]
pub enum ReportDecision {
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
    Dismissed,
    CommunityDeleted,
    Unknown,
}

/// The reported account's standing in the community now; `Unknown` for a
/// value a later server adds.
#[uniffi::remote(Enum)]
pub enum TargetStanding {
    Owner,
    Moderator,
    Member,
    Muted,
    Banned,
    NotMember,
    Gone,
    Unknown,
}

/// The reported content's state now; `Unknown` for a value a later server
/// adds.
#[uniffi::remote(Enum)]
pub enum TargetState {
    Visible,
    Hidden,
    Removed,
    Gone,
    Unknown,
}

/// A report in a moderator's queue. The account that made it is never
/// shown.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct Report {
    pub report_id: String,
    /// None for one about an account, made to the platform.
    pub community_id: Option<String>,
    pub target: ReportTarget,
    /// Whose content it is, or the account reported; none once deleted.
    pub target_account: Option<Author>,
    pub reason: ReportReason,
    pub note: String,
    pub state: ReportState,
    /// Unix milliseconds.
    pub created_at: u64,
    pub closed_at: Option<u64>,
    /// What closed it; none while open.
    pub decision: Option<ReportDecision>,
    /// The reason the action gave, or the closing resolution.
    pub resolution: Option<String>,
    /// Who closed it; none while open, when the community's deletion did,
    /// or once that account is deleted.
    pub closed_by: Option<Author>,
    /// The reported post is anonymous (0091): `target_account` is none, and
    /// a moderator may `reveal_author`.
    #[uniffi(default = false)]
    pub target_anonymous: bool,
    /// The reported account's standing in the community now.
    pub target_standing: Option<TargetStanding>,
    /// The reported content's state now.
    pub target_state: Option<TargetState>,
}

impl From<api::Report> for Report {
    fn from(report: api::Report) -> Self {
        let api::Report {
            report_id,
            community_id,
            target,
            target_account,
            reason,
            note,
            state,
            created_at,
            closed_at,
            decision,
            resolution,
            closed_by,
            target_anonymous,
            target_standing,
            target_state,
        } = report;

        Self {
            report_id,
            community_id,
            target: target.into(),
            target_account,
            reason,
            note,
            state,
            created_at,
            closed_at,
            decision,
            resolution,
            closed_by,
            target_anonymous,
            target_standing,
            target_state,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ReportPage {
    pub reports: Vec<Report>,
    /// The `after` of the next page; none on the last.
    pub next: Option<String>,
}

/// What a moderator can do in a community. The post, comment or account it
/// acts on is the `target_id` of `moderate`.
#[uniffi::remote(Enum)]
pub enum ModerationAction {
    HidePost,
    RemovePost,
    RestorePost,
    HideComment,
    RemoveComment,
    RestoreComment,
    /// Takes `until` on `moderate`.
    MuteMember,
    UnmuteMember,
    RemoveMember,
    BanMember,
    UnbanMember,
}

/// What a moderation log entry acted on; `Unknown` for a value a later
/// server adds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum LogTargetKind {
    Post,
    Comment,
    Community,
    Account,
    Report,
    Unknown,
}

impl From<api::LogTargetKind> for LogTargetKind {
    fn from(kind: api::LogTargetKind) -> Self {
        use api::LogTargetKind as K;
        match kind {
            K::Post => Self::Post,
            K::Comment => Self::Comment,
            K::Community => Self::Community,
            K::Account => Self::Account,
            K::Report => Self::Report,
            K::Unknown => Self::Unknown,
        }
    }
}

/// The post, comment, account, community or report an entry acted on.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct LogTarget {
    pub kind: LogTargetKind,
    pub id: String,
}

impl From<api::LogTarget> for LogTarget {
    fn from(target: api::LogTarget) -> Self {
        let api::LogTarget { kind, id } = target;

        Self {
            kind: kind.into(),
            id,
        }
    }
}

/// A page of a community's moderation log, newest first.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ModerationLogPage {
    pub entries: Vec<ModerationLogEntry>,
    /// The `before` of the next, older page; none on the last.
    pub next: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, uniffi::Enum)]
pub enum CardKind {
    Post,
    Comment,
    Community,
}

/// A stable reference to a post, a comment or a community, which `cards`
/// shows.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct CardRef {
    pub kind: CardKind,
    pub id: String,
}

impl From<api::Ref> for CardRef {
    fn from(reference: api::Ref) -> Self {
        let api::Ref { kind, id } = reference;

        Self {
            kind: match kind {
                api::RefKind::Post => CardKind::Post,
                api::RefKind::Comment => CardKind::Comment,
                api::RefKind::Community => CardKind::Community,
            },
            id,
        }
    }
}

impl From<CardRef> for api::Ref {
    fn from(reference: CardRef) -> Self {
        let CardRef { kind, id } = reference;

        Self {
            kind: match kind {
                CardKind::Post => api::RefKind::Post,
                CardKind::Comment => api::RefKind::Comment,
                CardKind::Community => api::RefKind::Community,
            },
            id,
        }
    }
}

/// The community a card's post or comment is in, or the card's community.
#[uniffi::remote(Record)]
pub struct CardCommunity {
    pub community_id: String,
    pub name: String,
    /// The picture's version (0080); none when it has no picture.
    #[uniffi(default = None)]
    pub photo: Option<String>,
}

/// What a reference shows, as a report in the queue or a shared link
/// shows it. An excerpt is the text's first 280 characters, an ellipsis
/// ending one cut short.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum Card {
    /// Gone, or not this account's to see.
    Unavailable { reference: CardRef },
    Post {
        reference: CardRef,
        community: CardCommunity,
        /// None on an anonymous post (0091).
        author: Option<Author>,
        excerpt: String,
        image: Option<PostImage>,
        /// Unix milliseconds.
        created_at: u64,
    },
    Comment {
        reference: CardRef,
        community: CardCommunity,
        post_id: String,
        author: Author,
        excerpt: String,
        /// Unix milliseconds.
        created_at: u64,
    },
    Community {
        reference: CardRef,
        community: CardCommunity,
        description: String,
        audience: CommunityAudience,
        /// None for a private community this account is not a member of.
        member_count: Option<u64>,
    },
}

impl From<api::Card> for Card {
    fn from(card: api::Card) -> Self {
        match card {
            api::Card::Unavailable { reference } => Self::Unavailable {
                reference: reference.into(),
            },
            api::Card::Post {
                reference,
                community,
                author,
                excerpt,
                image,
                created_at,
            } => Self::Post {
                reference: reference.into(),
                community,
                author,
                excerpt,
                image: image.map(Into::into),
                created_at,
            },
            api::Card::Comment {
                reference,
                community,
                post_id,
                author,
                excerpt,
                created_at,
            } => Self::Comment {
                reference: reference.into(),
                community,
                post_id,
                author,
                excerpt,
                created_at,
            },
            api::Card::Community {
                reference,
                community,
                description,
                audience,
                member_count,
            } => Self::Community {
                reference: reference.into(),
                community,
                description,
                audience: audience.into(),
                member_count,
            },
        }
    }
}

/// Communities.
#[uniffi::export]
impl CoreClient {
    /// A page of the communities this account may see; `query` keeps those
    /// whose name matches it, and `after` is the `next` of the page before.
    /// At most 50 a page.
    pub fn communities(
        &self,
        query: Option<String>,
        after: Option<String>,
        limit: u32,
    ) -> Result<CommunityPage, CoreError> {
        let page = self
            .hosted
            .communities(query.as_deref(), after.as_deref(), limit)?;
        Ok(CommunityPage {
            communities: communities(page.communities),
            next: page.next,
        })
    }

    /// Every community this account is a member of.
    pub fn my_communities(&self) -> Result<Vec<Community>, CoreError> {
        Ok(communities(self.hosted.my_communities()?))
    }

    /// A new community, owned by this account. `Invalid` for a blank name.
    pub fn create_community(
        &self,
        name: String,
        description: String,
        audience: CommunityAudience,
    ) -> Result<Community, CoreError> {
        Ok(self
            .hosted
            .create_community(&name, &description, audience.into())?
            .into())
    }

    /// One community; `Refused` with 404 for none this account may see.
    pub fn community(&self, community_id: String) -> Result<Community, CoreError> {
        Ok(self.hosted.community(&community_id)?.into())
    }

    /// Renames a community, changes its description, or makes an open one
    /// private; only its owner may. `Invalid` for a blank name, and
    /// `Refused` with 409 `audience_locked` since a private community never
    /// becomes open (0063).
    pub fn update_community(
        &self,
        community_id: String,
        name: Option<String>,
        description: Option<String>,
        audience: Option<CommunityAudience>,
    ) -> Result<Community, CoreError> {
        Ok(self
            .hosted
            .update_community(
                &community_id,
                name.as_deref(),
                description.as_deref(),
                audience.map(Into::into),
            )?
            .into())
    }

    /// Sets a community's picture from the image at `path`; its owner or a
    /// moderator may. `Invalid` for an empty image or one over 10 MB,
    /// `Refused` with 400 `invalid_image` for what the server cannot decode,
    /// and 403 for anyone else. Returns the new version (0080).
    pub fn set_community_avatar(
        &self,
        community_id: String,
        path: String,
    ) -> Result<String, CoreError> {
        Ok(self
            .client()?
            .set_community_avatar(&community_id, Path::new(&path))?)
    }

    /// Removes a community's picture; no error when there was none (0080).
    pub fn remove_community_avatar(&self, community_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.remove_community_avatar(&community_id)?)
    }

    /// Sets a community's cover from the image at `path`, as
    /// `set_community_avatar` does the picture (0080).
    pub fn set_community_cover(
        &self,
        community_id: String,
        path: String,
    ) -> Result<String, CoreError> {
        Ok(self
            .client()?
            .set_community_cover(&community_id, Path::new(&path))?)
    }

    /// Removes a community's cover; no error when there was none (0080).
    pub fn remove_community_cover(&self, community_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.remove_community_cover(&community_id)?)
    }

    /// The path of a community's picture at `version`, the `photo` of its
    /// `Community`: fetched once per version and kept by the core. None when
    /// it has none or the reader may not see it; draw the initials then,
    /// and while this runs (0080).
    pub fn community_picture(
        &self,
        community_id: String,
        version: String,
    ) -> Result<Option<String>, CoreError> {
        Ok(self
            .client()?
            .community_picture(&community_id, &version)?
            .as_deref()
            .map(path_string))
    }

    /// The path of a community's cover at `version`, as `community_picture`
    /// does the picture (0080).
    pub fn community_cover(
        &self,
        community_id: String,
        version: String,
    ) -> Result<Option<String>, CoreError> {
        Ok(self
            .client()?
            .community_cover(&community_id, &version)?
            .as_deref()
            .map(path_string))
    }

    /// Frames a community's picture again (0086) from the master the server
    /// kept: its owner or a moderator, with no new upload. Returns the new
    /// version, which `community_picture_framed` fetches. `NoMaster` for a
    /// picture set before masters were kept, which is uploaded once more;
    /// `Invalid` for a framing the server would refuse; 403 for anyone else.
    pub fn set_community_picture_framing(
        &self,
        community_id: String,
        framing: Framing,
    ) -> Result<String, CoreError> {
        Ok(self
            .client()?
            .set_community_picture_framing(&community_id, &framing.into())?)
    }

    /// Frames a community's cover again, as `set_community_picture_framing`
    /// does the picture. A rectangle in `overrides` sets one size class on
    /// its own; the others follow the focus. Returns the new version.
    pub fn set_community_cover_framing(
        &self,
        community_id: String,
        framing: Framing,
    ) -> Result<String, CoreError> {
        Ok(self
            .client()?
            .set_community_cover_framing(&community_id, &framing.into())?)
    }

    /// The path of a community's picture at `version` in `frame` (`Square`),
    /// as `community_picture` does without one: fetched once per version
    /// and kept per frame (0086).
    pub fn community_picture_framed(
        &self,
        community_id: String,
        version: String,
        frame: Frame,
    ) -> Result<Option<String>, CoreError> {
        Ok(self
            .client()?
            .community_picture_framed(&community_id, &version, frame)?
            .as_deref()
            .map(path_string))
    }

    /// The path of a community's cover at `version` in `frame` (`Compact`,
    /// `Medium` or `Expanded`, chosen by the window's width with
    /// `frame_for_width`): fetched once per version and kept per frame,
    /// each frame with only its latest version (0086).
    pub fn community_cover_framed(
        &self,
        community_id: String,
        version: String,
        frame: Frame,
    ) -> Result<Option<String>, CoreError> {
        Ok(self
            .client()?
            .community_cover_framed(&community_id, &version, frame)?
            .as_deref()
            .map(path_string))
    }

    /// Writes the master of a community's picture to `path`, for the editor
    /// to frame again; its owner or a moderator. False when there is none:
    /// no picture, or one set before masters were kept (0086).
    pub fn community_picture_source(
        &self,
        community_id: String,
        path: String,
    ) -> Result<bool, CoreError> {
        Ok(self
            .client()?
            .community_picture_source(&community_id, Path::new(&path))?)
    }

    /// Writes the master of a community's cover to `path`, as
    /// `community_picture_source` does the picture (0086).
    pub fn community_cover_source(
        &self,
        community_id: String,
        path: String,
    ) -> Result<bool, CoreError> {
        Ok(self
            .client()?
            .community_cover_source(&community_id, Path::new(&path))?)
    }

    /// The community's members, its owner and moderators first.
    pub fn community_members(
        &self,
        community_id: String,
    ) -> Result<Vec<CommunityMember>, CoreError> {
        let members = self.hosted.community_members(&community_id)?;
        Ok(members.into_iter().map(Into::into).collect())
    }

    /// Makes a member a moderator, or a moderator a member again; only the
    /// community's owner may.
    pub fn set_community_role(
        &self,
        community_id: String,
        account_id: String,
        role: CommunityRole,
    ) -> Result<(), CoreError> {
        Ok(self
            .hosted
            .set_community_role(&community_id, &account_id, role.into())?)
    }

    /// Joins an open community at once, or asks a private one's moderators.
    pub fn join_community(&self, community_id: String) -> Result<JoinState, CoreError> {
        Ok(self.hosted.join_community(&community_id)?)
    }

    /// Takes back a join request that waits; no error when none does.
    pub fn withdraw_join_request(&self, community_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.withdraw_join_request(&community_id)?)
    }

    /// The join requests that wait; for a moderator of the community.
    pub fn join_requests(&self, community_id: String) -> Result<Vec<JoinRequest>, CoreError> {
        let requests = self.hosted.join_requests(&community_id)?;
        Ok(requests.into_iter().collect())
    }

    /// Takes the requesting account in as a member.
    pub fn approve_join_request(
        &self,
        community_id: String,
        account_id: String,
    ) -> Result<(), CoreError> {
        Ok(self
            .hosted
            .approve_join_request(&community_id, &account_id)?)
    }

    /// Declines a join request; the account sees the decline, and may ask
    /// again only after 30 days or an invitation.
    pub fn decline_join_request(
        &self,
        community_id: String,
        account_id: String,
    ) -> Result<(), CoreError> {
        Ok(self
            .hosted
            .decline_join_request(&community_id, &account_id)?)
    }

    /// Deletes a community (its owner or a platform moderator); it can be
    /// restored for 30 days.
    pub fn delete_community(&self, community_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.delete_community(&community_id)?)
    }

    /// Restores a deleted community. `Refused` with 409 `purged` after the
    /// 30 days.
    pub fn restore_community(&self, community_id: String) -> Result<Community, CoreError> {
        Ok(self.hosted.restore_community(&community_id)?.into())
    }

    /// Leaves a community. Its owner is `Refused` with 409.
    pub fn leave_community(&self, community_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.leave_community(&community_id)?)
    }
}

/// Posts, comments and reactions.
#[uniffi::export]
impl CoreClient {
    /// A page of a community's posts, newest first, those whose body matches
    /// `query` when there is one; `before` is the `next` of the page before.
    /// At most 50 a page.
    #[uniffi::method(default(query = None))]
    pub fn community_posts(
        &self,
        community_id: String,
        before: Option<String>,
        limit: u32,
        query: Option<String>,
    ) -> Result<PostPage, CoreError> {
        let page = self.hosted.community_posts(
            &community_id,
            query.as_deref(),
            before.as_deref(),
            limit,
        )?;
        Ok(PostPage {
            posts: page.posts.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// A page of a community's images (0089), newest first; `cursor` is the
    /// `next` of the page before. At most 50 a page.
    pub fn community_images(
        &self,
        community_id: String,
        cursor: Option<String>,
        limit: u32,
    ) -> Result<CommunityImagePage, CoreError> {
        let page = self
            .hosted
            .community_images(&community_id, cursor.as_deref(), limit)?;
        Ok(CommunityImagePage {
            images: page.images.into_iter().collect(),
            next: page.next,
        })
    }

    /// A page of the posts of every community this account is a member of,
    /// newest first; `before` is the `next` of the page before. At most 50 a
    /// page.
    pub fn feed(&self, before: Option<String>, limit: u32) -> Result<PostPage, CoreError> {
        let page = self.hosted.feed(before.as_deref(), limit)?;
        Ok(PostPage {
            posts: page.posts.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// Posts a text, up to 4 images from `upload_post_image`, or both, to a
    /// community. `Invalid` for neither, or for over 4 images.
    pub fn create_post(
        &self,
        community_id: String,
        body: String,
        media: Vec<String>,
    ) -> Result<Post, CoreError> {
        Ok(self
            .hosted
            .create_post(&community_id, &body, &media)?
            .into())
    }

    /// `create_post` with the options of 0090 and 0091. `anonymous` posts
    /// without this account's name and waits for a moderator; `Refused`
    /// with 409 `anonymous_off` where the community does not allow it.
    /// `poll` makes it a poll: `body` is the question, with two to six
    /// distinct options and no image, else `Invalid`.
    #[uniffi::method(default(media = [], anonymous = false, poll = None))]
    pub fn create_post_with(
        &self,
        community_id: String,
        body: String,
        media: Vec<String>,
        anonymous: bool,
        poll: Option<Vec<String>>,
    ) -> Result<Post, CoreError> {
        Ok(self
            .hosted
            .create_post_with(&community_id, &body, &media, anonymous, poll.as_deref())?
            .into())
    }

    /// Votes in a poll, or changes the vote; `Refused` with 409
    /// `poll_closed` once it is closed (0090). The post as it now reads.
    pub fn vote_poll(&self, post_id: String, option_id: String) -> Result<Post, CoreError> {
        Ok(self.hosted.vote_poll(&post_id, &option_id)?.into())
    }

    /// Takes this account's vote back; no error when it had none.
    pub fn withdraw_vote(&self, post_id: String) -> Result<Post, CoreError> {
        Ok(self.hosted.withdraw_vote(&post_id)?.into())
    }

    /// Closes a poll; its author, the community's owner or a moderator may.
    pub fn close_poll(&self, post_id: String) -> Result<Post, CoreError> {
        Ok(self.hosted.close_poll(&post_id)?.into())
    }

    /// Lets members of a community post without their name (0091), or
    /// stops it; only its owner may.
    pub fn set_anonymous_posts(
        &self,
        community_id: String,
        on: bool,
    ) -> Result<Community, CoreError> {
        Ok(self.hosted.set_anonymous_posts(&community_id, on)?.into())
    }

    /// The anonymous posts waiting for approval, newest first (0091); a
    /// moderator's. `before` is the `next` of the page before. At most 50 a
    /// page.
    pub fn pending_anonymous_posts(
        &self,
        community_id: String,
        before: Option<String>,
        limit: u32,
    ) -> Result<PostPage, CoreError> {
        let page = self
            .hosted
            .pending_anonymous_posts(&community_id, before.as_deref(), limit)?;
        Ok(PostPage {
            posts: page.posts.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// Publishes an anonymous post, still without its author; a moderator's.
    pub fn approve_anonymous_post(&self, post_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.approve_anonymous_post(&post_id)?)
    }

    /// Deletes an anonymous post and tells its author; a moderator's.
    pub fn decline_anonymous_post(&self, post_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.decline_anonymous_post(&post_id)?)
    }

    /// Who wrote an anonymous post; a moderator's. The moderation log
    /// records who asked, never whom (0091).
    pub fn reveal_author(&self, post_id: String) -> Result<Author, CoreError> {
        Ok(self.hosted.reveal_author(&post_id)?)
    }

    /// Uploads the image at `path` for a post in the community (0065): a
    /// JPEG, PNG, WebP, GIF or AVIF of at most 10 MB, which the server
    /// re-encodes to WebP. Its `media_id` goes in `create_post` within a day.
    pub fn upload_post_image(
        &self,
        community_id: String,
        path: String,
    ) -> Result<PostImage, CoreError> {
        Ok(self
            .client()?
            .upload_social_media(&community_id, Path::new(&path))?
            .into())
    }

    /// The path of a post's image, a WebP: fetched once and kept by the core.
    pub fn post_image(&self, post_id: String, media_id: String) -> Result<String, CoreError> {
        Ok(path_string(
            &self.client()?.post_media(&post_id, &media_id)?,
        ))
    }

    pub fn post(&self, post_id: String) -> Result<Post, CoreError> {
        Ok(self.hosted.post(&post_id)?.into())
    }

    /// Deletes this account's own post.
    pub fn delete_post(&self, post_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.delete_post(&post_id)?)
    }

    /// Sets this account's one reaction on a post, in place of any other.
    pub fn react(&self, post_id: String, emoji: String) -> Result<(), CoreError> {
        Ok(self.hosted.react(&post_id, &emoji)?)
    }

    /// Takes this account's reaction off a post; no error when it had none.
    pub fn unreact(&self, post_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.unreact(&post_id)?)
    }

    /// Likes a comment; liking twice is one like (0080).
    pub fn like_comment(&self, comment_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.like_comment(&comment_id)?)
    }

    /// Takes this account's like off a comment; no error when it had none.
    pub fn unlike_comment(&self, comment_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.unlike_comment(&comment_id)?)
    }

    /// Features a post (0080, 0088); a moderator's. `Refused` with 409
    /// `pin_limit` when three are featured already: release one first.
    pub fn pin_post(&self, community_id: String, post_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.pin_post(&community_id, &post_id)?)
    }

    /// Unpins the community's pinned post; no error when it is not pinned.
    pub fn unpin_post(&self, community_id: String, post_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.unpin_post(&community_id, &post_id)?)
    }

    /// Pins a community to the top of this account's own list (0080).
    pub fn pin_community(&self, community_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.pin_community(&community_id)?)
    }

    /// Unpins a community; no error when it was not pinned.
    pub fn unpin_community(&self, community_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.unpin_community(&community_id)?)
    }

    /// A page of a post's comments, oldest first; `after` is the `next` of
    /// the page before. At most 100 a page.
    pub fn comments(
        &self,
        post_id: String,
        after: Option<String>,
        limit: u32,
    ) -> Result<CommentPage, CoreError> {
        let page = self.hosted.comments(&post_id, after.as_deref(), limit)?;
        Ok(CommentPage {
            comments: page.comments.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// Comments on a post: a text, one image from `upload_post_image`, or
    /// both (0082); a reply when `parent_comment_id` names the comment it
    /// answers. `Invalid` for neither, for over one image, or a bad id.
    #[uniffi::method(default(parent_comment_id = None, media = []))]
    pub fn create_comment(
        &self,
        post_id: String,
        body: String,
        parent_comment_id: Option<String>,
        media: Vec<String>,
    ) -> Result<Comment, CoreError> {
        Ok(self
            .hosted
            .create_comment(&post_id, &body, parent_comment_id.as_deref(), &media)?
            .into())
    }

    /// Deletes this account's own comment.
    pub fn delete_comment(&self, comment_id: String) -> Result<(), CoreError> {
        Ok(self.hosted.delete_comment(&comment_id)?)
    }
}

/// Reports, moderation and cards.
#[uniffi::export]
impl CoreClient {
    /// Reports a post, a comment, a community or an account to the
    /// community's moderators or, with `to_platform`, the platform's. The
    /// moderators are never told who reported it.
    pub fn report(
        &self,
        target: ReportTarget,
        reason: ReportReason,
        note: String,
        to_platform: bool,
    ) -> Result<(), CoreError> {
        Ok(self.hosted.report(&api::NewReport {
            target: target.into(),
            reason,
            note,
            to_platform,
        })?)
    }

    /// A page of a community's reports, for its moderators: `Refused` with
    /// 403 for anyone else. `after` is the `next` of the page before.
    pub fn community_reports(
        &self,
        community_id: String,
        state: ReportState,
        after: Option<String>,
        limit: u32,
    ) -> Result<ReportPage, CoreError> {
        let page = self
            .hosted
            .community_reports(&community_id, state, after.as_deref(), limit)?;
        Ok(ReportPage {
            reports: page.reports.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// One moderator's action, which the community's log keeps with its
    /// `reason`. `target_id` is the post's, the comment's or the account's
    /// id; `report_id` the report it answers, if one; `until` (Unix
    /// milliseconds) with `MuteMember` and only with it, since a mute is
    /// for a time (0063). `Invalid` otherwise.
    pub fn moderate(
        &self,
        community_id: String,
        action: ModerationAction,
        target_id: String,
        reason: String,
        report_id: Option<String>,
        until: Option<u64>,
    ) -> Result<(), CoreError> {
        let moderation = api::Moderation {
            action,
            target_id,
            reason,
            report_id,
            until,
        };
        Ok(self.hosted.moderate(&community_id, &moderation)?)
    }

    /// Closes a report with what was done about it.
    pub fn close_report(&self, report_id: String, resolution: String) -> Result<(), CoreError> {
        Ok(self.hosted.close_report(&report_id, &resolution)?)
    }

    /// A page of a community's moderation log, newest first, for its
    /// moderators; `before` is the `next` of the page before. At most 100 a
    /// page.
    pub fn community_moderation_log(
        &self,
        community_id: String,
        before: Option<String>,
        limit: u32,
    ) -> Result<ModerationLogPage, CoreError> {
        let page = self
            .hosted
            .community_moderation_log(&community_id, before.as_deref(), limit)?;
        Ok(ModerationLogPage {
            entries: page.entries.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// What each reference shows, one card each in their order: at most 50.
    pub fn cards(&self, refs: Vec<CardRef>) -> Result<Vec<Card>, CoreError> {
        let refs: Vec<api::Ref> = refs.into_iter().map(Into::into).collect();
        Ok(self
            .hosted
            .cards(&refs)?
            .into_iter()
            .map(Into::into)
            .collect())
    }
}
