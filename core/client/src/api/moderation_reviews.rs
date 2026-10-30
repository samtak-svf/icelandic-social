//! The statement of reasons and the single review (0063, 0115): what a person
//! reads about an action on their content, and what a platform moderator
//! decides. The moderation log's action lives here too, since a statement
//! carries it.

use serde::{Deserialize, Serialize};

use super::{Api, ApiError, Author, LogTarget, Method, Transport, with_query};

/// What a moderation log entry records. A value a later server adds reads as
/// `Unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
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
    #[serde(other)]
    Unknown,
}

/// Where a review stands. A value a later server adds reads as `Unknown`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModerationReviewState {
    Open,
    Upheld,
    Overturned,
    #[serde(other)]
    Unknown,
}

/// A person's one review of an action on their content.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// Why a moderator acted on the caller's content. It never names who did.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// A page of statements, newest first, and the cursor of the next, older page.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct ModerationStatementPage {
    pub statements: Vec<ModerationStatement>,
    pub next: Option<String>,
}

/// A review waiting for a platform moderator.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// A page of waiting reviews, newest first, and the cursor of the next page.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct OpenModerationReviewPage {
    pub reviews: Vec<OpenModerationReview>,
    pub next: Option<String>,
}

/// What a platform moderator answers a review with.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReviewOutcome {
    Upheld,
    Overturned,
}

#[derive(Serialize)]
struct Decision<'a> {
    outcome: ReviewOutcome,
    reason: &'a str,
}

impl<T: Transport + ?Sized> Api<'_, T> {
    /// `moderationStatements`: what moderators did to the caller's content,
    /// newest first, older than `before`.
    pub fn moderation_statements(
        &self,
        before: Option<&str>,
        limit: u32,
    ) -> Result<ModerationStatementPage, ApiError> {
        let limit = limit.to_string();
        let params = [("before", before), ("limit", Some(&limit))];
        let path = with_query("/v1/moderation/statements", &params);
        self.call(Method::Get, path, None, "moderationStatements")
    }

    /// `askModerationReview`: asks once for a review of an action.
    pub fn ask_moderation_review(&self, entry_id: u64) -> Result<(), ApiError> {
        let path = format!("/v1/moderation/statements/{entry_id}/review");
        self.done(Method::Post, path, None)
    }

    /// `openModerationReviews`: the reviews waiting for a platform moderator.
    pub fn open_moderation_reviews(
        &self,
        before: Option<&str>,
        limit: u32,
    ) -> Result<OpenModerationReviewPage, ApiError> {
        let limit = limit.to_string();
        let params = [("before", before), ("limit", Some(&limit))];
        let path = with_query("/v1/moderation/reviews", &params);
        self.call(Method::Get, path, None, "openModerationReviews")
    }

    /// `decideModerationReview`: upholds or overturns the action.
    pub fn decide_moderation_review(
        &self,
        entry_id: u64,
        outcome: ReviewOutcome,
        reason: &str,
    ) -> Result<(), ApiError> {
        let path = format!("/v1/moderation/reviews/{entry_id}");
        let body = Decision { outcome, reason };
        self.done(Method::Post, path, Self::json(&body))
    }
}
