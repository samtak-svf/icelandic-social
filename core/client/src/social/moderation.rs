//! The moderation log, the statement of reasons and the single review as the
//! client offers them (0063, 0115).

use crate::api::{
    ModerationLogPage, ModerationStatementPage, OpenModerationReviewPage, ReviewOutcome, Transport,
};
use crate::{ClientError, Hosted};

use super::id;

impl<T: Transport> Hosted<T> {
    /// A page of a community's moderation log, newest first, for its
    /// moderators; `before` is the `next` of the page before. At most 100 a
    /// page.
    pub fn community_moderation_log(
        &self,
        community: &str,
        before: Option<&str>,
        size: u32,
    ) -> Result<ModerationLogPage, ClientError> {
        id(community, "community id")?;
        let api = self.api()?;
        Ok(api.community_moderation_log(community, before, size.clamp(1, 100))?)
    }

    /// What moderators did to this account's content and why, newest first.
    /// At most 100 a page.
    pub fn moderation_statements(
        &self,
        before: Option<&str>,
        size: u32,
    ) -> Result<ModerationStatementPage, ClientError> {
        let api = self.api()?;
        Ok(api.moderation_statements(before, size.clamp(1, 100))?)
    }

    /// Asks for the one review an action has.
    pub fn ask_moderation_review(&self, entry_id: u64) -> Result<(), ClientError> {
        Ok(self.api()?.ask_moderation_review(entry_id)?)
    }

    /// The reviews waiting for a platform moderator, newest first. At most
    /// 100 a page.
    pub fn open_moderation_reviews(
        &self,
        before: Option<&str>,
        size: u32,
    ) -> Result<OpenModerationReviewPage, ClientError> {
        let api = self.api()?;
        Ok(api.open_moderation_reviews(before, size.clamp(1, 100))?)
    }

    /// Answers a review, with the reason the person reads.
    pub fn decide_moderation_review(
        &self,
        entry_id: u64,
        outcome: ReviewOutcome,
        reason: &str,
    ) -> Result<(), ClientError> {
        let reason = reason.trim();
        if reason.is_empty() {
            return Err(ClientError::Invalid("a decision needs a reason"));
        }
        let api = self.api()?;
        Ok(api.decide_moderation_review(entry_id, outcome, reason)?)
    }
}
