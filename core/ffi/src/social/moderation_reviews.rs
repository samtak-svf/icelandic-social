//! The statement of reasons and the single review (0063, 0115) as the apps see
//! them: what a person reads about an action on their content, and what a
//! platform moderator decides.

use spjall_client::api;
pub use spjall_client::api::{ModerationLogAction, ModerationReviewState, ReviewOutcome};

use crate::CoreError;
use crate::client::CoreClient;
use crate::social::{Author, LogTarget};

/// What a moderation log entry records; `Unknown` for a later server's value.
#[uniffi::remote(Enum)]
pub enum ModerationLogAction {
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
    ClearAccountPhoto,
    /// A moderator closed a report about the content.
    CloseReport,
    DeleteCommunity,
    RestoreCommunity,
    SetCommunityPicture,
    RemoveCommunityPicture,
    SetCommunityCover,
    RemoveCommunityCover,
    PinPost,
    UnpinPost,
    ClosePoll,
    AnonymousPostsOn,
    AnonymousPostsOff,
    RevealAuthor,
    ReviewUpheld,
    ReviewOverturned,
    Unknown,
}

/// Where a review stands; `Unknown` for a later server's value.
#[uniffi::remote(Enum)]
pub enum ModerationReviewState {
    Open,
    Upheld,
    Overturned,
    Unknown,
}

/// What a platform moderator answers a review with.
#[uniffi::remote(Enum)]
pub enum ReviewOutcome {
    Upheld,
    Overturned,
}

/// A person's one review of an action on their content.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ModerationReview {
    pub state: ModerationReviewState,
    /// Unix milliseconds.
    pub asked_at: u64,
    pub decided_at: Option<u64>,
    /// The decider's reason, once decided.
    pub reason: Option<String>,
    /// The content came back. False on an overturned review when it no longer
    /// exists, as a cleared photo does not.
    pub restored: bool,
}

impl From<api::ModerationReview> for ModerationReview {
    fn from(review: api::ModerationReview) -> Self {
        let api::ModerationReview {
            state,
            asked_at,
            decided_at,
            reason,
            restored,
        } = review;

        Self {
            state,
            asked_at,
            decided_at,
            reason,
            restored,
        }
    }
}

/// Why a moderator acted on this account's content. It never names who did.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ModerationStatement {
    pub entry_id: u64,
    pub action: ModerationLogAction,
    pub target: LogTarget,
    pub community_id: Option<String>,
    /// The moderator's reason, as written.
    pub reason: String,
    /// Unix milliseconds.
    pub created_at: u64,
    /// The text the action was on, while it is kept (90 days after a removal).
    pub body: Option<String>,
    /// No review was asked for yet and the content has not come back since.
    pub can_ask: bool,
    pub review: Option<ModerationReview>,
}

impl From<api::ModerationStatement> for ModerationStatement {
    fn from(statement: api::ModerationStatement) -> Self {
        let api::ModerationStatement {
            entry_id,
            action,
            target,
            community_id,
            reason,
            created_at,
            body,
            can_ask,
            review,
        } = statement;

        Self {
            entry_id,
            action,
            target: target.into(),
            community_id,
            reason,
            created_at,
            body,
            can_ask,
            review: review.map(Into::into),
        }
    }
}

/// A page of statements, newest first, and the cursor of the next, older page.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct ModerationStatementPage {
    pub statements: Vec<ModerationStatement>,
    pub next: Option<String>,
}

/// A review waiting for a platform moderator.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct OpenModerationReview {
    pub entry_id: u64,
    pub action: ModerationLogAction,
    pub target: LogTarget,
    pub community_id: Option<String>,
    /// The post to open, when the target is a post or a comment on one.
    pub post_id: Option<String>,
    /// Who acted; none once that account is deleted.
    pub actor: Option<Author>,
    /// Whose content it is; none on an anonymous post and once deleted.
    pub target_account: Option<Author>,
    pub reason: String,
    /// Unix milliseconds.
    pub created_at: u64,
    /// The text, while it is kept; none means deciding without it.
    pub body: Option<String>,
    pub asked_at: u64,
    /// False for the moderator who acted and for the person who asked.
    pub can_decide: bool,
}

impl From<api::OpenModerationReview> for OpenModerationReview {
    fn from(review: api::OpenModerationReview) -> Self {
        let api::OpenModerationReview {
            entry_id,
            action,
            target,
            community_id,
            post_id,
            actor,
            target_account,
            reason,
            created_at,
            body,
            asked_at,
            can_decide,
        } = review;

        Self {
            entry_id,
            action,
            target: target.into(),
            community_id,
            post_id,
            actor,
            target_account,
            reason,
            created_at,
            body,
            asked_at,
            can_decide,
        }
    }
}

/// A page of waiting reviews, newest first, and the cursor of the next page.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct OpenModerationReviewPage {
    pub reviews: Vec<OpenModerationReview>,
    pub next: Option<String>,
}

#[uniffi::export]
impl CoreClient {
    /// What moderators did to this account's content and why, newest first;
    /// `before` is the `next` of the page before. At most 100 a page.
    pub fn moderation_statements(
        &self,
        before: Option<String>,
        limit: u32,
    ) -> Result<ModerationStatementPage, CoreError> {
        let page = self
            .hosted
            .moderation_statements(before.as_deref(), limit)?;
        Ok(ModerationStatementPage {
            statements: page.statements.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// Asks for the one review an action has.
    pub fn ask_moderation_review(&self, entry_id: u64) -> Result<(), CoreError> {
        Ok(self.hosted.ask_moderation_review(entry_id)?)
    }

    /// The reviews waiting for a platform moderator, newest first. At most
    /// 100 a page.
    pub fn open_moderation_reviews(
        &self,
        before: Option<String>,
        limit: u32,
    ) -> Result<OpenModerationReviewPage, CoreError> {
        let page = self
            .hosted
            .open_moderation_reviews(before.as_deref(), limit)?;
        Ok(OpenModerationReviewPage {
            reviews: page.reviews.into_iter().map(Into::into).collect(),
            next: page.next,
        })
    }

    /// Answers a review, with the reason the person reads.
    pub fn decide_moderation_review(
        &self,
        entry_id: u64,
        outcome: ReviewOutcome,
        reason: String,
    ) -> Result<(), CoreError> {
        Ok(self
            .hosted
            .decide_moderation_review(entry_id, outcome, &reason)?)
    }
}
